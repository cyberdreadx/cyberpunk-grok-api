/**
 * /api/comfyui - ComfyUI proxy for all authenticated users.
 *
 * Supports two backends:
 *   1. RunPod Serverless (RUNPOD_ENDPOINT_ID + RUNPOD_API_KEY) — cloud GPU
 *   2. Local ComfyUI (COMFYUI_URL) — direct connection via tunnel
 *
 * POST { action: "status" }    - health check
 * POST { action: "models" }    - list available checkpoints
 * POST { action: "generate" }  - submit workflow, deduct credits, return jobId + seed
 * POST { action: "poll" }      - check job status, return base64 image/video when done
 *
 * Requires auth. Admin gets free usage; regular users pay credits.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

const ADMIN_EMAIL = "cyberdreadx@proton.me";

const COMFY_COSTS: Record<string, number> = {
  "txt2img": 1,
  "qwen-edit": 1,
  "qwen-edit-hd": 2,
  "wan-video": 3,
  "longlook": 3, // per sequence — actual cost = sequenceCount * 3
};

// ---- Video LoRA pairing ----

interface VideoLoraEntry {
  name: string;       // Display name (e.g. "pornmaster_slow_twerk")
  high?: string;      // Filename for high noise pass
  low?: string;       // Filename for low noise pass
  single?: string;    // Filename if not paired (applied per user-selected pass)
}

/**
 * Group video LoRA filenames into paired entries.
 * Detects pairs by common suffixes:
 *   _high_noise / _low_noise   (e.g. pornmaster_slow_twerk_high_noise.safetensors)
 *   -H- / -L-                  (e.g. NSFW-22-H-e8.safetensors)
 *   _H / _L                    (e.g. something_H.safetensors)
 * Other files become single entries.
 */
function groupVideoLoras(files: string[]): VideoLoraEntry[] {
  const pairs = new Map<string, { high?: string; low?: string }>();
  const singles: string[] = [];

  // Patterns: [regex to match, group 1 = base name, "high" or "low"]
  const highPatterns = [
    /^(.+)_high_noise$/,   // pornmaster_slow_twerk_high_noise
    /^(.+)-H-(.+)$/,      // NSFW-22-H-e8  (capture both sides as base)
    /^(.+)_H$/,            // something_H
  ];
  const lowPatterns = [
    /^(.+)_low_noise$/,
    /^(.+)-L-(.+)$/,
    /^(.+)_L$/,
  ];

  for (const f of files) {
    const noExt = f.replace(/\.[^.]+$/, "");
    let matched = false;

    // Check high patterns
    for (let i = 0; i < highPatterns.length; i++) {
      const m = noExt.match(highPatterns[i]);
      if (m) {
        // For -H-/-L- patterns, build base from both sides: "NSFW-22" + "-e8" → "NSFW-22-e8"
        const base = i === 1 ? `${m[1]}-${m[2]}` : m[1];
        const entry = pairs.get(base) || {};
        entry.high = f;
        pairs.set(base, entry);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Check low patterns
    for (let i = 0; i < lowPatterns.length; i++) {
      const m = noExt.match(lowPatterns[i]);
      if (m) {
        const base = i === 1 ? `${m[1]}-${m[2]}` : m[1];
        const entry = pairs.get(base) || {};
        entry.low = f;
        pairs.set(base, entry);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    singles.push(f);
  }

  const result: VideoLoraEntry[] = [];
  for (const [base, { high, low }] of pairs) {
    result.push({ name: base, high, low });
  }
  for (const f of singles) {
    const name = f.replace(/\.[^.]+$/, "");
    result.push({ name, single: f });
  }
  return result;
}

// ---- Backend detection ----

type Backend = "runpod" | "local";

function getBackend(): { mode: Backend; runpodEndpoint?: string; runpodKey?: string; comfyUrl?: string } {
  const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
  const runpodKey = process.env.RUNPOD_API_KEY;
  if (runpodEndpoint && runpodKey) {
    return { mode: "runpod", runpodEndpoint, runpodKey };
  }
  const comfyUrl = process.env.COMFYUI_URL;
  if (comfyUrl) {
    return { mode: "local", comfyUrl: comfyUrl.replace(/\/+$/, "") };
  }
  return { mode: "local" };
}

// ---- Workflow builders ----

const WAN_DEFAULT_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

/**
 * WAN 2.2 Image-to-Video workflow (API format).
 *
 * Two-pass sampling (high noise → low noise) with optional Lightx2v 4-step LoRA,
 * optional RIFE frame interpolation, and optional 4x-UltraSharp upscale.
 */
function buildWanVideoWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  frameCount: number;
  useRife: boolean;
  useUpscale: boolean;
  videoLora?: string;
  videoLoraHigh?: string;
  videoLoraLow?: string;
  videoLoraStrength?: number;
  videoLoraPass?: "high" | "low" | "both";
}): Record<string, any> {
  const halfSteps = Math.max(1, Math.floor(p.steps / 2));

  const workflow: Record<string, any> = {
    // Text encoder
    "84": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        type: "wan",
        device: "default",
      },
    },
    // VAE
    "90": {
      class_type: "VAELoader",
      inputs: { vae_name: "wan_2.1_vae.safetensors" },
    },
    // High-noise diffusion model
    "95": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
        weight_dtype: "default",
      },
    },
    // Low-noise diffusion model
    "96": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
        weight_dtype: "default",
      },
    },
    // High-noise LoRA (4-step acceleration)
    "101": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["95", 0],
        lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
        strength_model: 1.0,
      },
    },
    // Low-noise LoRA
    "102": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["96", 0],
        lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
        strength_model: 1.0,
      },
    },
    // Shift scheduling — high noise path
    "104": {
      class_type: "ModelSamplingSD3",
      inputs: { model: ["101", 0], shift: 5.0 },
    },
    // Shift scheduling — low noise path
    "103": {
      class_type: "ModelSamplingSD3",
      inputs: { model: ["102", 0], shift: 5.0 },
    },
    // Start image
    "97": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
    // Positive prompt
    "93": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["84", 0], text: p.prompt },
    },
    // Negative prompt
    "89": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["84", 0], text: p.negativePrompt },
    },
    // Image-to-Video conditioning
    "98": {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["93", 0],
        negative: ["89", 0],
        vae: ["90", 0],
        start_image: ["97", 0],
        width: p.width,
        height: p.height,
        length: p.frameCount,
        batch_size: 1,
      },
    },
    // Pass 1: high-noise sampler
    "86": {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["104", 0],
        positive: ["98", 0],
        negative: ["98", 1],
        latent_image: ["98", 2],
        add_noise: "enable",
        noise_seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: 0,
        end_at_step: halfSteps,
        return_with_leftover_noise: "enable",
      },
    },
    // Pass 2: low-noise sampler
    "85": {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["103", 0],
        positive: ["98", 0],
        negative: ["98", 1],
        latent_image: ["86", 0],
        add_noise: "disable",
        noise_seed: 0,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: halfSteps,
        end_at_step: p.steps,
        return_with_leftover_noise: "disable",
      },
    },
    // Decode latent → frames
    "87": {
      class_type: "VAEDecode",
      inputs: { samples: ["85", 0], vae: ["90", 0] },
    },
  };

  // Optional user video LoRA — insert between accel LoRA and shift scheduling
  // Paired LoRAs (separate high/low files) always apply to both passes since they're designed for it.
  // Single-file LoRAs respect videoLoraPass (defaults to "high" — applying to low-noise pass
  // with a non-paired LoRA causes wavy/underwater artifacts).
  const isPaired = !!(p.videoLoraHigh && p.videoLoraLow);
  const hasHigh = isPaired || p.videoLoraHigh || (p.videoLora && (p.videoLoraPass === "high" || p.videoLoraPass === "both"));
  const hasLow = isPaired || p.videoLoraLow || (p.videoLora && (p.videoLoraPass === "low" || p.videoLoraPass === "both"));
  const str = p.videoLoraStrength ?? 0.8;

  if (hasHigh) {
    const loraFile = p.videoLoraHigh || p.videoLora!;
    workflow["110"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["101", 0],
        lora_name: loraFile,
        strength_model: str,
      },
    };
    workflow["104"].inputs.model = ["110", 0];
  }

  if (hasLow) {
    const loraFile = p.videoLoraLow || p.videoLora!;
    workflow["111"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["102", 0],
        lora_name: loraFile,
        strength_model: str,
      },
    };
    workflow["103"].inputs.model = ["111", 0];
  }

  // Post-processing chain
  let lastNode = "87";
  let lastOut = 0;
  let fps = 16;

  if (p.useRife) {
    workflow["116"] = {
      class_type: "RIFE VFI",
      inputs: {
        frames: [lastNode, lastOut],
        ckpt_name: "rife47.pth",
        clear_cache_after_n_frames: 10,
        multiplier: 2,
        fast_mode: false,
        ensemble: true,
        scale_factor: 1,
      },
    };
    lastNode = "116";
    lastOut = 0;
    fps = 24;
  }

  if (p.useUpscale) {
    workflow["118"] = {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: "4x-UltraSharp.pth" },
    };
    workflow["117"] = {
      class_type: "ImageUpscaleWithModel",
      inputs: { upscale_model: ["118", 0], image: [lastNode, lastOut] },
    };
    lastNode = "117";
    lastOut = 0;
  }

  // Encode frames → video → save
  workflow["94"] = {
    class_type: "CreateVideo",
    inputs: { images: [lastNode, lastOut], fps: fps },
  };
  workflow["108"] = {
    class_type: "SaveVideo",
    inputs: {
      video: ["94", 0],
      filename_prefix: "video/GrokRunner",
      codec: "auto",
      format: "mp4",
    },
  };

  return workflow;
}

/**
 * LongLook Multi-Clip WAN 2.2 workflow (API format).
 *
 * Chains 1-4 sequences of video generation. Each sequence's last frame
 * becomes the next sequence's start frame. Uses GGUF-quantized models
 * (smoothMixWan22I2VT2V) for high/low noise passes.
 */
function buildLongLookWorkflow(p: {
  prompts: string[];
  negativePrompt: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  frameCount: number;
  useRife: boolean;
  useUpscale: boolean;
  videoLora?: string;
  videoLoraHigh?: string;
  videoLoraLow?: string;
  videoLoraStrength?: number;
  videoLoraPass?: "high" | "low" | "both";
}): Record<string, any> {
  const halfSteps = Math.max(1, Math.floor(p.steps / 2));
  const seqCount = Math.min(4, Math.max(1, p.prompts.length));

  const workflow: Record<string, any> = {};

  // ── Shared nodes (built once) ──

  // CLIPLoader
  workflow["10"] = {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      type: "wan",
      device: "default",
    },
  };

  // VAELoader
  workflow["11"] = {
    class_type: "VAELoader",
    inputs: { vae_name: "wan_2.1_vae.safetensors" },
  };

  // High noise diffusion model (same FP8 models as WAN video workflow)
  workflow["12"] = {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
      weight_dtype: "default",
    },
  };

  // Low noise diffusion model
  workflow["13"] = {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
      weight_dtype: "default",
    },
  };

  // High-noise LoRA (4-step acceleration)
  workflow["14"] = {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      model: ["12", 0],
      lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
      strength_model: 1.0,
    },
  };

  // Low-noise LoRA (4-step acceleration)
  workflow["15"] = {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      model: ["13", 0],
      lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
      strength_model: 1.0,
    },
  };

  // Track the model node that feeds into ModelSamplingSD3
  let highModelSource: [string, number] = ["14", 0];
  let lowModelSource: [string, number] = ["15", 0];

  // Optional user video LoRA — paired LoRAs always apply to both passes
  const isPairedLora = !!(p.videoLoraHigh && p.videoLoraLow);
  const hasHighLora = isPairedLora || p.videoLoraHigh || (p.videoLora && (p.videoLoraPass === "high" || p.videoLoraPass === "both"));
  const hasLowLora = isPairedLora || p.videoLoraLow || (p.videoLora && (p.videoLoraPass === "low" || p.videoLoraPass === "both"));
  const loraStr = p.videoLoraStrength ?? 0.8;

  if (hasHighLora) {
    const loraFile = p.videoLoraHigh || p.videoLora!;
    workflow["16"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: highModelSource,
        lora_name: loraFile,
        strength_model: loraStr,
      },
    };
    highModelSource = ["16", 0];
  }

  if (hasLowLora) {
    const loraFile = p.videoLoraLow || p.videoLora!;
    workflow["17"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: lowModelSource,
        lora_name: loraFile,
        strength_model: loraStr,
      },
    };
    lowModelSource = ["17", 0];
  }

  // ModelSamplingSD3 — high noise shift
  workflow["22"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: highModelSource, shift: 5.0 },
  };

  // ModelSamplingSD3 — low noise shift
  workflow["23"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: lowModelSource, shift: 5.0 },
  };

  // UpscaleModelLoader (if needed)
  if (p.useUpscale) {
    workflow["24"] = {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: "RealESRGAN_x2.pth" },
    };
  }

  // Start image
  workflow["25"] = {
    class_type: "LoadImage",
    inputs: { image: p.imageFilename },
  };

  // ── Per-sequence nodes ──
  const seqOutputNodes: string[] = [];

  for (let i = 0; i < seqCount; i++) {
    const base = 1000 + i * 100;
    const promptText = p.prompts[i] || p.prompts[p.prompts.length - 1];

    // CLIPTextEncode positive
    const posNode = `${base}`;
    workflow[posNode] = {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["10", 0], text: promptText },
    };

    // CLIPTextEncode negative
    const negNode = `${base + 1}`;
    workflow[negNode] = {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["10", 0], text: p.negativePrompt },
    };

    // ImageResizeKJ — resize input image (or previous last frame) to target
    const resizeNode = `${base + 2}`;

    // Determine source image for this sequence
    let sourceImage: [string, number];
    if (i === 0) {
      sourceImage = ["25", 0]; // LoadImage
    } else {
      // FinalFrameSelector from previous sequence
      const prevBase = 1000 + (i - 1) * 100;
      sourceImage = [`${prevBase + 7}`, 0]; // FinalFrameSelector
    }

    workflow[resizeNode] = {
      class_type: "ImageResizeKJ",
      inputs: {
        image: sourceImage,
        width: p.width,
        height: p.height,
        upscale_method: "lanczos",
        keep_proportion: false,
        divisible_by: 2,
        get_image_size: false,
      },
    };

    // Conditioning: WanImageToVideo for seq 0, WanContinuationConditioning for seq 1+
    const condNode = `${base + 3}`;
    if (i === 0) {
      workflow[condNode] = {
        class_type: "WanImageToVideo",
        inputs: {
          positive: [posNode, 0],
          negative: [negNode, 0],
          vae: ["11", 0],
          start_image: [resizeNode, 0],
          width: p.width,
          height: p.height,
          length: p.frameCount,
          batch_size: 1,
        },
      };
    } else {
      workflow[condNode] = {
        class_type: "WanImageToVideo",
        inputs: {
          positive: [posNode, 0],
          negative: [negNode, 0],
          vae: ["11", 0],
          start_image: [resizeNode, 0],
          width: p.width,
          height: p.height,
          length: p.frameCount,
          batch_size: 1,
        },
      };
    }

    // KSamplerAdvanced (high noise)
    const highSampler = `${base + 4}`;
    workflow[highSampler] = {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["22", 0],
        positive: [condNode, 0],
        negative: [condNode, 1],
        latent_image: [condNode, 2],
        add_noise: "enable",
        noise_seed: p.seed + i,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: 0,
        end_at_step: halfSteps,
        return_with_leftover_noise: "enable",
      },
    };

    // KSamplerAdvanced (low noise)
    const lowSampler = `${base + 5}`;
    workflow[lowSampler] = {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["23", 0],
        positive: [condNode, 0],
        negative: [condNode, 1],
        latent_image: [highSampler, 0],
        add_noise: "disable",
        noise_seed: 0,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: halfSteps,
        end_at_step: p.steps,
        return_with_leftover_noise: "disable",
      },
    };

    // VAEDecode
    const decodeNode = `${base + 6}`;
    workflow[decodeNode] = {
      class_type: "VAEDecode",
      inputs: { samples: [lowSampler, 0], vae: ["11", 0] },
    };

    // FinalFrameSelector (for sequences 0 to N-2, to feed next sequence)
    if (i < seqCount - 1) {
      const ffNode = `${base + 7}`;
      workflow[ffNode] = {
        class_type: "FinalFrameSelector",
        inputs: { images: [decodeNode, 0] },
      };
    }

    // Track the decoded output (before RIFE/upscale) for post-processing
    let seqLastNode = decodeNode;
    let seqLastOut = 0;

    // RIFE per sequence
    if (p.useRife) {
      const rifeNode = `${base + 8}`;
      workflow[rifeNode] = {
        class_type: "RIFE VFI",
        inputs: {
          frames: [seqLastNode, seqLastOut],
          ckpt_name: "rife47.pth",
          clear_cache_after_n_frames: 10,
          multiplier: 2,
          fast_mode: false,
          ensemble: true,
          scale_factor: 1,
        },
      };
      seqLastNode = rifeNode;
      seqLastOut = 0;
    }

    // Upscale per sequence
    if (p.useUpscale) {
      const upscaleNode = `${base + 9}`;
      workflow[upscaleNode] = {
        class_type: "ImageUpscaleWithModel",
        inputs: { upscale_model: ["24", 0], image: [seqLastNode, seqLastOut] },
      };
      seqLastNode = upscaleNode;
      seqLastOut = 0;
    }

    seqOutputNodes.push(seqLastNode);
  }

  // ── Final output nodes ──

  const fps = p.useRife ? 30 : 16;

  if (seqCount === 1) {
    // Single sequence — output directly via VHS_VideoCombine
    workflow["900"] = {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: [seqOutputNodes[0], 0],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: "video/GrokRunner_LongLook",
        format: "video/h264-mp4",
        pingpong: false,
        save_output: true,
        unique_id: "900",
      },
    };
  } else {
    // Multiple sequences — combine with ImageBatchMulti then encode
    const batchInputs: Record<string, any> = {
      inputcount: seqCount,
    };
    for (let i = 0; i < seqCount; i++) {
      batchInputs[`image_${i + 1}`] = [seqOutputNodes[i], 0];
    }
    workflow["899"] = {
      class_type: "ImageBatchMulti",
      inputs: batchInputs,
    };
    workflow["900"] = {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["899", 0],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: "video/GrokRunner_LongLook",
        format: "video/h264-mp4",
        pingpong: false,
        save_output: true,
        unique_id: "900",
      },
    };
  }

  return workflow;
}

function buildTxt2ImgWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  checkpoint: string;
  lora?: string;
  loraStrength?: number;
}): Record<string, any> {
  // Auto-detect FLUX models — they need different sampler settings
  const isFlux = p.checkpoint.toLowerCase().includes("flux");
  const hasLora = !!p.lora && p.lora !== "none";

  // Model/clip source: goes through LoraLoader if a LoRA is selected
  const modelSource: [string, number] = hasLora ? ["10", 0] : ["4", 0];
  const clipSource: [string, number] = hasLora ? ["10", 1] : ["4", 1];

  const workflow: Record<string, any> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: p.checkpoint },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: p.prompt, clip: clipSource },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: isFlux ? "" : (p.negativePrompt || ""), clip: clipSource },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: p.seed,
        steps: isFlux ? Math.max(p.steps, 20) : p.steps,
        cfg: isFlux ? 1 : p.cfg,
        sampler_name: "euler",
        scheduler: isFlux ? "simple" : "normal",
        denoise: 1,
        model: modelSource,
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "GrokRunner", images: ["8", 0] },
    },
  };

  if (hasLora) {
    const strength = p.loraStrength ?? 0.8;
    workflow["10"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: p.lora!,
        strength_model: strength,
        strength_clip: strength,
        model: ["4", 0],
        clip: ["4", 1],
      },
    };
  }

  return workflow;
}

/**
 * Qwen Image Edit workflow (API format).
 * Derived from the user's "Normal NSFW Qwen edit" ComfyUI workflow.
 *
 * Flow: LoadImage -> TextEncodeQwenImageEditPlus (positive + negative)
 *       -> ModelSamplingAuraFlow -> CFGNorm -> KSampler -> cleanGpu -> VAEDecode -> SaveImage
 */
const TXT2IMG_DEFAULT_NEGATIVE =
  "cgi, 3d render, cartoon, anime, illustration, drawing, painting, sketch, plastic skin, smooth skin, airbrushed, doll-like, mannequin, blurry, low quality, worst quality, jpeg artifacts, deformed, bad anatomy, bad proportions, extra limbs, missing limbs, disfigured, ugly, watermark, text, signature, cropped";

const QWEN_DEFAULT_NEGATIVE =
  "smooth skin, plastic skin, waxy skin, cgi, 3d render, airbrushed, doll-like, mannequin, fake, cartoon, anime, illustration, drawing, painting, sketch, over-processed, over-smoothed, blurry, low quality, deformed, bad anatomy, bad proportions, extra limbs, disfigured, ugly, watermark, text, signature";

function buildQwenEditWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  checkpoint: string;
  upscale?: boolean;
}): Record<string, any> {
  return {
    "125": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: p.checkpoint },
    },
    "123": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
    "132": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["125", 1],
        vae: ["125", 2],
        image1: ["123", 0],
        prompt: p.prompt,
      },
    },
    "133": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["125", 1],
        vae: ["125", 2],
        prompt: p.negativePrompt,
      },
    },
    "64": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: ["125", 0], shift: 3 },
    },
    "65": {
      class_type: "CFGNorm",
      inputs: { model: ["64", 0], strength: 1 },
    },
    "148": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: 1 },
    },
    "75": {
      class_type: "KSampler",
      inputs: {
        model: ["65", 0],
        positive: ["132", 0],
        negative: ["133", 0],
        latent_image: ["148", 0],
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "sa_solver",
        scheduler: "beta",
        denoise: 1,
      },
    },
    "72": {
      class_type: "easy cleanGpuUsed",
      inputs: { anything: ["75", 0] },
    },
    "73": {
      class_type: "VAEDecode",
      inputs: { samples: ["72", 0], vae: ["125", 2] },
    },
    "77": {
      class_type: "SaveImage",
      inputs: { images: ["73", 0], filename_prefix: "GrokRunner" },
    },
    ...(p.upscale ? {
      "128": {
        class_type: "UpscaleModelLoader",
        inputs: { model_name: "4x_foolhardy_Remacri.pth" },
      },
      "126": {
        class_type: "UltimateSDUpscale",
        inputs: {
          image: ["73", 0],
          model: ["125", 0],
          positive: ["132", 0],
          negative: ["133", 0],
          vae: ["125", 2],
          upscale_model: ["128", 0],
          upscale_by: 1.5,
          seed: p.seed,
          steps: 6,
          cfg: p.cfg,
          sampler_name: "sa_solver",
          scheduler: "simple",
          denoise: 0.2,
          mode_type: "Linear",
          tile_width: 1024,
          tile_height: 1024,
          mask_blur: 8,
          tile_padding: 32,
          seam_fix_mode: "None",
          seam_fix_denoise: 1,
          seam_fix_width: 64,
          seam_fix_mask_blur: 8,
          seam_fix_padding: 16,
          force_uniform_tiles: true,
          tiled_decode: false,
        },
      },
      "200": {
        class_type: "SaveImage",
        inputs: { images: ["126", 0], filename_prefix: "GrokRunner_HD" },
      },
    } : {}),
  };
}

// ---- RunPod helpers ----

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

async function runpodRequest(
  endpoint: string,
  apiKey: string,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: any,
) {
  const url = `${RUNPOD_API_BASE}/${endpoint}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

// ---- Local ComfyUI helpers ----

async function uploadImageToLocal(baseUrl: string, imageBase64: string, rawName: string) {
  const base64Clean = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(base64Clean, "base64");

  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const ext = isJpeg ? "jpg" : isPng ? "png" : "png";
  const ct = isJpeg ? "image/jpeg" : "image/png";
  const fname = rawName || `upload_${Date.now()}.${ext}`;

  const boundary = `----ComfyUpload${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: ${ct}\r\n\r\n`
  );
  const footer = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`
  );
  const body = Buffer.concat([header, buf, footer]);

  const resp = await fetch(`${baseUrl}/upload/image`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Upload failed");
    throw new Error(`Image upload failed (${resp.status}): ${errText}`);
  }
  const result = await resp.json();
  return result.name as string;
}

// =============== Handler ===============

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: "Sign in to use Comfy Lab." });
  }

  const isAdminUser = auth.email === ADMIN_EMAIL;

  const backend = getBackend();
  if (backend.mode === "local" && !backend.comfyUrl) {
    return res.status(500).json({ error: "No ComfyUI backend configured. Set RUNPOD_ENDPOINT_ID + RUNPOD_API_KEY or COMFYUI_URL." });
  }

  const { action } = req.body || {};

  try {
    // ========== STATUS ==========
    if (action === "status") {
      if (backend.mode === "runpod") {
        const resp = await runpodRequest(backend.runpodEndpoint!, backend.runpodKey!, "/health");
        if (!resp.ok) throw new Error(`RunPod health returned ${resp.status}`);
        const data = await resp.json();
        // RunPod health returns { jobs: { completed, failed, inProgress, inQueue, retried }, workers: { idle, initializing, ready, running, throttled } }
        return res.status(200).json({
          connected: true,
          backend: "runpod",
          stats: data,
        });
      } else {
        const resp = await fetch(`${backend.comfyUrl}/system_stats`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) throw new Error(`ComfyUI returned ${resp.status}`);
        const stats = await resp.json();
        return res.status(200).json({ connected: true, backend: "local", stats });
      }
    }

    // ========== MODELS ==========
    if (action === "models") {
      if (backend.mode === "runpod") {
        const modelsEnv = process.env.COMFYUI_MODELS || "";
        const checkpoints = modelsEnv
          ? modelsEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : ["model.safetensors"];
        const lorasEnv = process.env.COMFYUI_LORAS || "";
        const loras = lorasEnv
          ? lorasEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : [];
        const videoLorasEnv = process.env.COMFYUI_VIDEO_LORAS || "";
        const videoLoraFiles = videoLorasEnv
          ? videoLorasEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : [];
        const videoLoras = groupVideoLoras(videoLoraFiles);
        return res.status(200).json({ checkpoints, loras, videoLoras });
      } else {
        const resp = await fetch(
          `${backend.comfyUrl}/object_info/CheckpointLoaderSimple`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!resp.ok) throw new Error(`ComfyUI returned ${resp.status}`);
        const info = await resp.json();
        const checkpoints: string[] =
          info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        // Try to fetch LoRA list too
        let loras: string[] = [];
        try {
          const loraResp = await fetch(
            `${backend.comfyUrl}/object_info/LoraLoader`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (loraResp.ok) {
            const loraInfo = await loraResp.json();
            loras = loraInfo?.LoraLoader?.input?.required?.lora_name?.[0] || [];
          }
        } catch { /* best effort */ }
        // For local mode, video LoRAs are in the same lora folder
        const videoLorasEnv = process.env.COMFYUI_VIDEO_LORAS || "";
        const videoLoraFiles = videoLorasEnv
          ? videoLorasEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : [];
        const videoLoras = groupVideoLoras(videoLoraFiles);
        return res.status(200).json({ checkpoints, loras, videoLoras });
      }
    }

    // ========== GENERATE ==========
    if (action === "generate") {
      const {
        workflow: workflowType = "txt2img",
        prompt,
        negativePrompt = "",
        width = 512,
        height = 512,
        seed,
        steps = 20,
        cfg = 7,
        checkpoint,
        lora,
        loraStrength = 0.8,
        imageBase64,
        imageFilename: clientFilename,
        upscale,
        frameCount = 81,
        useRife = false,
        useUpscale: useVidUpscale = false,
        videoLora,
        videoLoraStrength = 0.8,
        videoLoraPass = "both",
        sequenceCount = 2,
      } = req.body;

      if (!prompt)
        return res.status(400).json({ error: "Prompt is required" });
      // Checkpoint is required for txt2img only; qwen-edit and wan-video use fixed models
      if (workflowType === "txt2img" && !checkpoint)
        return res.status(400).json({ error: "Checkpoint is required" });

      // ── Credit gate (admin is free) ──
      // skipCredits: client passes true for the first step of a chained workflow
      // (e.g. txt2img as part of text-to-video — the video step pays for both)
      const skipCredits = req.body.skipCredits === true;
      const costKey = workflowType === "qwen-edit" && upscale ? "qwen-edit-hd" : workflowType;
      const baseCost = COMFY_COSTS[costKey] ?? 1;
      const cost = skipCredits ? 0 : (workflowType === "longlook" ? baseCost * Math.min(4, Math.max(1, Number(sequenceCount))) : baseCost);
      let creditDeducted = false;

      if (!isAdminUser) {
        // Rate limit: 20 comfy requests per 5 min
        const { allowed } = await checkRateLimit(auth.userId, "comfyui", { max: 20, windowSeconds: 300 });
        if (!allowed) {
          return res.status(429).json({ error: "Too many ComfyUI requests. Please wait a moment." });
        }

        const sql = getDb();
        const rows = await sql`SELECT sub_credits, pack_credits FROM users WHERE id = ${auth.userId}`;
        if (rows.length === 0) return res.status(404).json({ error: "User not found." });

        const totalCredits = (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
        if (totalCredits < cost) {
          return res.status(402).json({ error: `Not enough credits. This costs ${cost} credit${cost !== 1 ? "s" : ""}.` });
        }

        try {
          await sql`SELECT deduct_credits(${auth.userId}::uuid, ${cost})`;
          creditDeducted = true;
        } catch (err: any) {
          return res.status(402).json({ error: "Failed to deduct credits. " + (err.message || "") });
        }
      }

      const actualSeed =
        seed != null && seed !== ""
          ? Number(seed)
          : Math.floor(Math.random() * 2 ** 32);

      const clampW = Math.min(2048, Math.max(256, Number(width)));
      const clampH = Math.min(2048, Math.max(256, Number(height)));
      const clampSteps = Math.min(100, Math.max(1, Number(steps)));
      const clampCfg = Math.min(30, Math.max(0.1, Number(cfg)));

      // Workflows that need a start image
      const needsImage = workflowType === "qwen-edit" || workflowType === "wan-video" || workflowType === "longlook";

      // Determine image filename for workflow
      let imageFilename: string | undefined;

      if (needsImage) {
        if (!imageBase64 && !clientFilename) {
          return res.status(400).json({ error: `Image is required for ${workflowType}` });
        }

        if (backend.mode === "runpod") {
          imageFilename = clientFilename || `input_${workflowType}_${Date.now()}.jpg`;
        } else {
          if (imageBase64) {
            imageFilename = await uploadImageToLocal(
              backend.comfyUrl!,
              imageBase64,
              clientFilename || `input_${workflowType}_${Date.now()}.jpg`,
            );
          } else {
            imageFilename = clientFilename;
          }
        }
      }

      // Build the workflow
      let workflow: Record<string, any>;
      if (workflowType === "wan-video") {
        // Resolve video LoRA — could be a paired entry name or a direct filename
        let resolvedVideoLora: string | undefined;
        let resolvedVideoLoraHigh: string | undefined;
        let resolvedVideoLoraLow: string | undefined;
        if (videoLora) {
          const videoLoraFiles = (process.env.COMFYUI_VIDEO_LORAS || "")
            .split(",").map((m: string) => m.trim()).filter(Boolean);
          const grouped = groupVideoLoras(videoLoraFiles);
          const match = grouped.find((g) => g.name === videoLora);
          if (match) {
            if (match.high && match.low) {
              // Paired LoRA — apply each to its respective pass
              resolvedVideoLoraHigh = match.high;
              resolvedVideoLoraLow = match.low;
            } else if (match.single) {
              resolvedVideoLora = match.single;
            } else {
              // Only one half of a pair exists
              resolvedVideoLoraHigh = match.high;
              resolvedVideoLoraLow = match.low;
            }
          } else {
            // Direct filename (not grouped)
            resolvedVideoLora = videoLora;
          }
        }

        workflow = buildWanVideoWorkflow({
          prompt: prompt.trim(),
          negativePrompt: (negativePrompt || "").trim() || WAN_DEFAULT_NEGATIVE,
          imageFilename: imageFilename!,
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
          frameCount: Math.min(241, Math.max(17, Number(frameCount))),
          useRife: !!useRife,
          useUpscale: !!useVidUpscale,
          videoLora: resolvedVideoLora,
          videoLoraHigh: resolvedVideoLoraHigh,
          videoLoraLow: resolvedVideoLoraLow,
          videoLoraStrength: Number(videoLoraStrength),
          videoLoraPass: (["high", "low", "both"].includes(videoLoraPass) ? videoLoraPass : "both") as "high" | "low" | "both",
        });
      } else if (workflowType === "longlook") {
        // LongLook multi-clip workflow — split prompt via Grok LLM
        const seqN = Math.min(4, Math.max(1, Number(sequenceCount)));

        // Call xAI Grok to split the user prompt into N sub-prompts
        const xaiKey = process.env.XAI_API_KEY;
        if (!xaiKey) throw new Error("XAI_API_KEY not configured for LongLook prompt splitting");

        const llmSystemPrompt = `You are an AI prompt artist specialized in cinematic video generation.
Using one input image and one user prompt, generate ${seqN} fully independent but logically connected prompts that together form a short, dynamic video sequence.
First, analyze the user prompt to identify all key visual elements, style cues, mood, environment, subjects, and actions.
Then divide the scene into ${seqN} consecutive sequences, each representing a clear moment in time.
Rules for each prompt:
- Each prompt must be self-contained, usable on its own
- Maintain visual, stylistic, and narrative consistency across all prompts
- Predict and describe natural motion progression from the previous sequence
- Include both motion description and camera movement
Output must be exactly formatted as: "***1***Prompt1***2***Prompt2***3***Prompt3..." with no line breaks.`;

        const llmResp = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${xaiKey}`,
          },
          body: JSON.stringify({
            model: "grok-3-mini",
            messages: [
              { role: "system", content: llmSystemPrompt },
              { role: "user", content: prompt.trim() },
            ],
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!llmResp.ok) {
          const errText = await llmResp.text().catch(() => "");
          throw new Error(`LLM prompt split failed (${llmResp.status}): ${errText.slice(0, 300)}`);
        }

        const llmData = await llmResp.json();
        const llmContent: string = llmData.choices?.[0]?.message?.content || "";

        // Parse "***1***Prompt1***2***Prompt2..." format
        const splitPrompts: string[] = [];
        const parts = llmContent.split(/\*\*\*\d+\*\*\*/);
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed) splitPrompts.push(trimmed);
        }

        // Fallback: if parsing failed, use the raw prompt for all sequences
        const prompts = splitPrompts.length >= 1 ? splitPrompts.slice(0, seqN) : Array(seqN).fill(prompt.trim());
        // Pad if we got fewer prompts than sequences
        while (prompts.length < seqN) prompts.push(prompts[prompts.length - 1]);

        // Resolve video LoRA (same logic as wan-video)
        let resolvedVideoLora2: string | undefined;
        let resolvedVideoLoraHigh2: string | undefined;
        let resolvedVideoLoraLow2: string | undefined;
        if (videoLora) {
          const videoLoraFiles = (process.env.COMFYUI_VIDEO_LORAS || "")
            .split(",").map((m: string) => m.trim()).filter(Boolean);
          const grouped = groupVideoLoras(videoLoraFiles);
          const match = grouped.find((g) => g.name === videoLora);
          if (match) {
            if (match.high && match.low) {
              resolvedVideoLoraHigh2 = match.high;
              resolvedVideoLoraLow2 = match.low;
            } else if (match.single) {
              resolvedVideoLora2 = match.single;
            } else {
              resolvedVideoLoraHigh2 = match.high;
              resolvedVideoLoraLow2 = match.low;
            }
          } else {
            resolvedVideoLora2 = videoLora;
          }
        }

        workflow = buildLongLookWorkflow({
          prompts,
          negativePrompt: (negativePrompt || "").trim() || WAN_DEFAULT_NEGATIVE,
          imageFilename: imageFilename!,
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: Math.min(100, Math.max(1, Number(steps) || 8)),
          cfg: Number(cfg) || 1,
          frameCount: Math.min(241, Math.max(17, Number(frameCount))),
          useRife: !!useRife,
          useUpscale: !!useVidUpscale,
          videoLora: resolvedVideoLora2,
          videoLoraHigh: resolvedVideoLoraHigh2,
          videoLoraLow: resolvedVideoLoraLow2,
          videoLoraStrength: Number(videoLoraStrength),
          videoLoraPass: (["high", "low", "both"].includes(videoLoraPass) ? videoLoraPass : "both") as "high" | "low" | "both",
        });
      } else if (workflowType === "qwen-edit") {
        // Qwen edit always uses the Qwen checkpoint — ignore client checkpoint
        const qwenCkpt = process.env.COMFYUI_QWEN_MODEL || "Qwen-Rapid-AIO-v2.safetensors";
        workflow = buildQwenEditWorkflow({
          prompt: prompt.trim(),
          negativePrompt: (negativePrompt || "").trim() || QWEN_DEFAULT_NEGATIVE,
          imageFilename: imageFilename!,
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
          checkpoint: qwenCkpt,
          upscale: !!upscale,
        });
      } else {
        workflow = buildTxt2ImgWorkflow({
          prompt: prompt.trim(),
          negativePrompt: (negativePrompt || "").trim() || TXT2IMG_DEFAULT_NEGATIVE,
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
          checkpoint,
          lora: lora || undefined,
          loraStrength: Number(loraStrength) || 0.8,
        });
      }

      // Resolve which RunPod endpoint to use (WAN video may have its own)
      const isVideoWorkflow = workflowType === "wan-video" || workflowType === "longlook";
      const runpodEndpoint = isVideoWorkflow
        ? (process.env.RUNPOD_WAN_ENDPOINT_ID || backend.runpodEndpoint)
        : backend.runpodEndpoint;

      // Submit to the appropriate backend
      if (backend.mode === "runpod") {
        const runpodInput: any = { workflow };

        if (needsImage && imageBase64) {
          runpodInput.images = [
            {
              name: imageFilename!,
              image: imageBase64,
            },
          ];
        }

        const resp = await runpodRequest(
          runpodEndpoint!,
          backend.runpodKey!,
          "/run",
          "POST",
          { input: runpodInput },
        );

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Unknown error");
          // Refund credits on submission failure
          if (creditDeducted) {
            const sql = getDb();
            await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`.catch(() => {});
          }
          throw new Error(`RunPod submit failed (${resp.status}): ${errText}`);
        }

        const result = await resp.json();

        // Log usage
        if (!isAdminUser) {
          const sql = getDb();
          const logMode = `comfy-${workflowType}`;
          await sql`
            INSERT INTO usage_log (user_id, mode, credits_used, prompt)
            VALUES (${auth.userId}::uuid, ${logMode}, ${cost}, ${(prompt || "").slice(0, 500)})
          `.catch(() => {});
        }

        return res.status(200).json({
          promptId: result.id,
          seed: actualSeed,
          backend: "runpod",
          outputType: isVideoWorkflow ? "video" : "image",
        });
      } else {
        // Local ComfyUI
        const resp = await fetch(`${backend.comfyUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow }),
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Unknown error");
          if (creditDeducted) {
            const sql = getDb();
            await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`.catch(() => {});
          }
          throw new Error(`ComfyUI prompt failed (${resp.status}): ${errText}`);
        }

        const result = await resp.json();

        if (!isAdminUser) {
          const sql = getDb();
          const logMode = `comfy-${workflowType}`;
          await sql`
            INSERT INTO usage_log (user_id, mode, credits_used, prompt)
            VALUES (${auth.userId}::uuid, ${logMode}, ${cost}, ${(prompt || "").slice(0, 500)})
          `.catch(() => {});
        }

        return res.status(200).json({
          promptId: result.prompt_id,
          seed: actualSeed,
          backend: "local",
          outputType: isVideoWorkflow ? "video" : "image",
        });
      }
    }

    // ========== POLL ==========
    if (action === "poll") {
      const { promptId, outputType } = req.body;
      if (!promptId)
        return res.status(400).json({ error: "promptId is required" });

      // Resolve which RunPod endpoint to poll (WAN video may have its own)
      const pollEndpoint = process.env.RUNPOD_WAN_ENDPOINT_ID && outputType === "video"
        ? process.env.RUNPOD_WAN_ENDPOINT_ID
        : backend.runpodEndpoint;

      if (backend.mode === "runpod") {
        const resp = await runpodRequest(
          pollEndpoint!,
          backend.runpodKey!,
          `/status/${promptId}`,
        );
        if (!resp.ok) throw new Error(`RunPod status failed (${resp.status})`);

        const data: any = await resp.json();

        // RunPod statuses: IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED, TIMED_OUT
        if (data.status === "COMPLETED") {
          // Check for video output first
          const videos = data.output?.videos;
          if (videos?.length) {
            const vid = videos[videos.length - 1];
            const base64Data = vid.data;
            const videoUri = base64Data.startsWith("data:")
              ? base64Data
              : `data:video/mp4;base64,${base64Data}`;
            return res.status(200).json({ status: "done", video: videoUri });
          }

          // Image output (worker-comfyui puts video data here too)
          const images = data.output?.images;
          if (images?.length) {
            const img = images[images.length - 1];
            const base64Data = img.data;
            // If this was a video job, the data is actually video bytes
            if (outputType === "video") {
              const videoUri = base64Data.startsWith("data:")
                ? base64Data
                : `data:video/mp4;base64,${base64Data}`;
              return res.status(200).json({ status: "done", video: videoUri });
            }
            const imageUri = base64Data.startsWith("data:")
              ? base64Data
              : `data:image/png;base64,${base64Data}`;
            return res.status(200).json({ status: "done", image: imageUri });
          }
          // Fallback: older output format
          if (data.output?.message) {
            const msg = data.output.message;
            if (outputType === "video") {
              const videoUri = msg.startsWith("data:") ? msg : `data:video/mp4;base64,${msg}`;
              return res.status(200).json({ status: "done", video: videoUri });
            }
            const imageUri = msg.startsWith("data:") ? msg : `data:image/png;base64,${msg}`;
            return res.status(200).json({ status: "done", image: imageUri });
          }
          return res.status(200).json({ status: "error", error: "Job completed but no output found" });
        }

        if (data.status === "FAILED" || data.status === "CANCELLED" || data.status === "TIMED_OUT") {
          const errMsg = data.error || data.output?.error || `Job ${data.status.toLowerCase()}`;
          return res.status(200).json({ status: "error", error: errMsg });
        }

        // IN_QUEUE or IN_PROGRESS
        return res.status(200).json({
          status: "pending",
          runpodStatus: data.status,
          delayTime: data.delayTime,
          executionTime: data.executionTime,
        });
      } else {
        // Local ComfyUI polling
        const resp = await fetch(`${backend.comfyUrl}/history/${promptId}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok)
          throw new Error(`ComfyUI history failed (${resp.status})`);

        const history = await resp.json();
        const entry = history[promptId];

        if (!entry) {
          return res.status(200).json({ status: "pending" });
        }

        if (entry.status?.status_str === "error") {
          const msgs = entry.status?.messages;
          const errStr = Array.isArray(msgs)
            ? msgs.map((m: any) => (typeof m === "string" ? m : JSON.stringify(m))).join(", ")
            : "Generation failed";
          return res.status(200).json({ status: "error", error: errStr });
        }

        const outputs = entry.outputs || {};

        // Check for video outputs first (SaveVideo node)
        for (const nodeId of Object.keys(outputs)) {
          const videos = outputs[nodeId]?.videos || outputs[nodeId]?.gifs;
          if (videos?.length) {
            const vid = videos[videos.length - 1];
            const params = new URLSearchParams({
              filename: vid.filename,
              subfolder: vid.subfolder || "",
              type: vid.type || "output",
            });

            const vidResp = await fetch(`${backend.comfyUrl}/view?${params}`, {
              signal: AbortSignal.timeout(60000), // videos can be larger
            });
            if (!vidResp.ok)
              throw new Error(`Failed to fetch video (${vidResp.status})`);

            const buffer = await vidResp.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            const ct = vidResp.headers.get("content-type") || "video/mp4";

            return res.status(200).json({
              status: "done",
              video: `data:${ct};base64,${base64}`,
            });
          }
        }

        // Check for image outputs
        for (const nodeId of Object.keys(outputs)) {
          const images = outputs[nodeId]?.images;
          if (images?.length) {
            const img = images[images.length - 1];
            const params = new URLSearchParams({
              filename: img.filename,
              subfolder: img.subfolder || "",
              type: img.type || "output",
            });

            const imgResp = await fetch(`${backend.comfyUrl}/view?${params}`, {
              signal: AbortSignal.timeout(10000),
            });
            if (!imgResp.ok)
              throw new Error(`Failed to fetch image (${imgResp.status})`);

            const buffer = await imgResp.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            const ct = imgResp.headers.get("content-type") || "image/png";

            return res.status(200).json({
              status: "done",
              image: `data:${ct};base64,${base64}`,
            });
          }
        }

        return res.status(200).json({ status: "pending" });
      }
    }

    // ========== UPLOAD-IMAGE (legacy, local-only) ==========
    if (action === "upload-image") {
      if (backend.mode === "runpod") {
        // RunPod doesn't need separate uploads — images go with the generate call
        return res.status(200).json({
          filename: req.body.filename || `upload_${Date.now()}.jpg`,
          info: "RunPod mode: image will be sent with generate request",
        });
      }

      const { imageBase64, filename: rawName } = req.body;
      if (!imageBase64)
        return res.status(400).json({ error: "imageBase64 is required" });

      const fname = await uploadImageToLocal(backend.comfyUrl!, imageBase64, rawName);
      return res.status(200).json({ filename: fname, subfolder: "", type: "input" });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error("[comfyui]", err.message);

    const isTimeout =
      err.name === "TimeoutError" || err.message?.includes("timeout");
    const isConn =
      err.cause?.code === "ECONNREFUSED" ||
      err.message?.includes("ECONNREFUSED") ||
      err.message?.includes("fetch failed");

    if (isTimeout || isConn) {
      return res.status(502).json({
        error: backend.mode === "runpod"
          ? "RunPod endpoint not responding. Check endpoint status."
          : "Cannot reach ComfyUI. Check tunnel and local server.",
      });
    }

    return res.status(500).json({ error: err.message || "ComfyUI request failed" });
  }
}

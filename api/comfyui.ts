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
import { S3Client, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

// ── RunPod S3 Helper ───────────────────────────────────────────────────
// RunPod's S3 doesn't support presigned URL query-string auth, so we use
// the AWS SDK with credentials to download files server-side.

let _s3Client: S3Client | null = null;
function getS3Client(): S3Client | null {
  if (_s3Client) return _s3Client;
  const endpoint = process.env.RUNPOD_S3_ENDPOINT;
  const accessKey = process.env.RUNPOD_S3_ACCESS_KEY;
  const secretKey = process.env.RUNPOD_S3_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) return null;
  // Extract region from endpoint (e.g. "us-nc-1" from "https://s3api-us-nc-1.runpod.io")
  const regionMatch = endpoint.match(/s3api-([\w-]+)\./)?.[1] || "us-east-1";
  _s3Client = new S3Client({
    endpoint,
    region: regionMatch,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  return _s3Client;
}

/**
 * Parse an S3 presigned URL to extract bucket and key.
 * URL format: https://s3api-us-nc-1.runpod.io/{bucket}/{key}?presigned-params
 */
function parseS3Url(url: string): { bucket: string; key: string } | null {
  try {
    const u = new URL(url);
    // Strip query params and leading slash
    const path = u.pathname.replace(/^\//, "");
    const slashIdx = path.indexOf("/");
    if (slashIdx < 1) return null;
    return {
      bucket: path.substring(0, slashIdx),
      key: path.substring(slashIdx + 1),
    };
  } catch { return null; }
}

/** Download a file from RunPod S3 using authenticated SDK. Returns Buffer or null. */
async function downloadFromS3(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const client = getS3Client();
  if (!client) {
    console.error("[s3] No S3 credentials configured (RUNPOD_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY)");
    return null;
  }
  const parsed = parseS3Url(url);
  const bucket = parsed?.bucket || process.env.RUNPOD_S3_BUCKET;
  const key = parsed?.key;
  if (!bucket || !key) {
    console.error("[s3] Could not parse bucket/key from URL:", url.slice(0, 120));
    return null;
  }
  try {
    console.log(`[s3] Downloading s3://${bucket}/${key}`);
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const resp = await client.send(cmd);
    const stream = resp.Body;
    if (!stream) return null;
    // Convert readable stream to buffer
    const chunks: Uint8Array[] = [];
    // @ts-ignore - stream is a Readable in Node.js
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentType = resp.ContentType || "application/octet-stream";
    console.log(`[s3] Downloaded ${Math.round(buffer.byteLength / 1024)}KB (${contentType})`);
    return { buffer, contentType };
  } catch (err: any) {
    console.error(`[s3] Download failed: ${err.message}`);
    return null;
  }
}

export const config = {
  maxDuration: 120,
  api: { bodyParser: { sizeLimit: "20mb" } },
};

const ADMIN_EMAIL = "cyberdreadx@proton.me";

const COMFY_COSTS: Record<string, number> = {
  "txt2img": 1,
  "zimage": 1,
  "qwen-edit": 1,
  "qwen-edit-hd": 2,
  "wan-video": 2,
  "gltch-wan": 2,
  "gltch-wan-hd": 4,
  "longlook": 2, // per sequence — actual cost = sequenceCount * 2
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

// ---- Audio helper ----

/**
 * Add MMAudio ambient audio nodes to a video workflow.
 * Injects nodes 200-202 (model + features + sampler) and returns the audio node ID.
 * The caller should pass the audio output to VHS_VideoCombine.
 */
function addMMAudioNodes(
  workflow: Record<string, any>,
  framesNodeId: string,
  seed: number,
  audioPrompt: string,
): string {
  // Load MMAudio model
  workflow["200"] = {
    class_type: "MMAudioModelLoader",
    inputs: {
      mmaudio_model: "mmaudio_large_44k_v2_fp16.safetensors",
      base_precision: "fp16",
    },
  };
  // Load feature utils (synchformer + VAE + CLIP)
  workflow["201"] = {
    class_type: "MMAudioFeatureUtilsLoader",
    inputs: {
      synchformer_model: "mmaudio_synchformer_fp16.safetensors",
      vae_model: "mmaudio_vae_44k_fp16.safetensors",
      clip_model: "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors",
      precision: "fp16",
    },
  };
  // Sample audio from video frames
  workflow["202"] = {
    class_type: "MMAudioSampler",
    inputs: {
      mmaudio_model: ["200", 0],
      feature_utils: ["201", 0],
      images: [framesNodeId, 0],
      duration: 8,
      steps: 25,
      cfg: 4.5,
      seed,
      prompt: audioPrompt,
      negative_prompt: "silence, static, distortion",
      mask_away_clip: false,
      force_offload: true,
    },
  };
  return "202";
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
 * WAN 2.2 Remix NSFW Image-to-Video workflow — clean rebuild.
 *
 * Simple proven pipeline: WanImageToVideo conditioning → dual-pass
 * KSamplerAdvanced (high/low noise models) → VAEDecode → VHS output.
 * No experimental nodes (PainterI2V, FastUnsharpSharpen, VRAM_Debug).
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
  audioMode?: "none" | "ambient";
  audioPrompt?: string;
}): Record<string, any> {
  const splitStep = Math.max(1, Math.floor(p.steps / 2));

  const highModel = process.env.COMFYUI_WAN_HIGH_MODEL
    || "Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v2.1.safetensors";
  const lowModel = process.env.COMFYUI_WAN_LOW_MODEL
    || "Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v2.1.safetensors";
  const clipModel = process.env.COMFYUI_WAN_CLIP
    || "nsfw_wan_umt5-xxl_bf16_fixed.safetensors";

  // Model sources — may be overridden by LoRA nodes below
  let highModelSource: [string, number] = ["95", 0];
  let lowModelSource: [string, number] = ["96", 0];

  const workflow: Record<string, any> = {
    // CLIP text encoder
    "84": {
      class_type: "CLIPLoader",
      inputs: { clip_name: clipModel, type: "wan", device: "cpu" },
    },
    // VAE
    "90": {
      class_type: "VAELoader",
      inputs: { vae_name: "wan_2.1_vae.safetensors" },
    },
    // High-noise model
    "95": {
      class_type: "UNETLoader",
      inputs: { unet_name: highModel, weight_dtype: "fp8_e4m3fn" },
    },
    // Low-noise model
    "96": {
      class_type: "UNETLoader",
      inputs: { unet_name: lowModel, weight_dtype: "fp8_e4m3fn" },
    },
    // Load start image
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
  };

  // Optional user video LoRA — applied before ModelSamplingSD3
  const isPaired = !!(p.videoLoraHigh && p.videoLoraLow);
  const hasHigh = isPaired || p.videoLoraHigh || (p.videoLora && (p.videoLoraPass === "high" || p.videoLoraPass === "both"));
  const hasLow = isPaired || p.videoLoraLow || (p.videoLora && (p.videoLoraPass === "low" || p.videoLoraPass === "both"));
  const str = p.videoLoraStrength ?? 0.8;

  if (hasHigh) {
    workflow["110"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: highModelSource, lora_name: p.videoLoraHigh || p.videoLora!, strength_model: str },
    };
    highModelSource = ["110", 0];
  }
  if (hasLow) {
    workflow["115"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: lowModelSource, lora_name: p.videoLoraLow || p.videoLora!, strength_model: str },
    };
    lowModelSource = ["115", 0];
  }

  // ModelSamplingSD3 shift scheduling
  workflow["104"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: highModelSource, shift: 12 },
  };
  workflow["103"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: lowModelSource, shift: 12 },
  };

  // WanImageToVideo — standard conditioning (no experimental nodes)
  workflow["113"] = {
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
  };

  // Pass 1: high-noise sampler
  workflow["86"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["104", 0],
      positive: ["113", 0],
      negative: ["113", 1],
      latent_image: ["113", 2],
      add_noise: "enable",
      noise_seed: p.seed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: "uni_pc",
      scheduler: "beta",
      start_at_step: 0,
      end_at_step: splitStep,
      return_with_leftover_noise: "enable",
    },
  };

  // VRAM cleanup between passes — free high-noise model activations
  workflow["120"] = {
    class_type: "easy cleanGpuUsed",
    inputs: { anything: ["86", 0] },
  };

  // Pass 2: low-noise sampler
  workflow["85"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["103", 0],
      positive: ["113", 0],
      negative: ["113", 1],
      latent_image: ["120", 0],
      add_noise: "disable",
      noise_seed: p.seed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: "uni_pc",
      scheduler: "beta",
      start_at_step: splitStep,
      end_at_step: 10000,
      return_with_leftover_noise: "disable",
    },
  };

  // VAEDecode → frames
  workflow["87"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["85", 0], vae: ["90", 0] },
  };

  // Post-processing chain
  let lastNode = "87";
  let lastOut = 0;
  let fps = 24;

  if (p.useRife) {
    workflow["116"] = {
      class_type: "RIFE VFI",
      inputs: {
        frames: [lastNode, lastOut],
        ckpt_name: "rife47.pth",
        clear_cache_after_n_frames: 10,
        multiplier: 2,
        fast_mode: true,
        ensemble: false,
        scale_factor: 1,
      },
    };
    lastNode = "116";
    lastOut = 0;
    fps = 48;
  }

  if (p.useUpscale) {
    workflow["117"] = {
      class_type: "ImageScaleBy",
      inputs: { image: [lastNode, lastOut], upscale_method: "lanczos", scale_by: 2.0 },
    };
    lastNode = "117";
    lastOut = 0;
  }

  // MMAudio ambient sound generation (optional)
  const audioMode = p.audioMode || "none";
  let audioNodeId: string | undefined;
  if (audioMode === "ambient") {
    audioNodeId = addMMAudioNodes(workflow, "87", p.seed, p.audioPrompt || p.prompt);
  }

  // Video output
  workflow["94"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: [lastNode, lastOut],
      frame_rate: fps,
      loop_count: 0,
      filename_prefix: "GrokRunner",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      ...(audioNodeId ? { audio: [audioNodeId, 0] } : {}),
    },
  };

  return workflow;
}

/**
 * GLTCH WAN 2.2 I2V workflow — 2-stage GGUF pipeline with Lightx2v + Pusa LoRAs.
 *
 * Two-stage KSamplerAdvanced (euler / simple):
 *   Stage 1: High-noise GGUF + Lightx2v (str 5.6) + Pusa HIGH (str 1.5), cfg=1
 *   Stage 2: Low-noise GGUF + Lightx2v (str 2.0) + Pusa LOW (str 1.4), cfg=1
 *
 * Split defaults to ~66% high-noise steps, 33% low-noise.
 * Each model path gets SageAttention + fp16 accumulation + PatchModelPatcherOrder.
 * UnloadModel nodes free VRAM between stages.
 * Post-processing: ColorMatch → RealESRGAN 2x → RIFE 4x interpolation (60fps).
 */
function buildGltchWanWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  frameCount: number;
  resolution: number;
  useUpscale: boolean;
  videoLora?: string;
  videoLoraHigh?: string;
  videoLoraLow?: string;
  videoLoraStrength?: number;
  videoLoraPass?: "high" | "low" | "both";
  audioMode?: "none" | "ambient";
  audioPrompt?: string;
}): Record<string, any> {
  const splitStep = Math.max(1, Math.round(p.steps * 2 / 3));

  const highGguf = process.env.COMFYUI_WAN_HIGH_GGUF || "wan2.2_i2v_high_noise_14B_Q6_K.gguf";
  const lowGguf = process.env.COMFYUI_WAN_LOW_GGUF || "wan2.2_i2v_low_noise_14B_Q6_K.gguf";
  const clipModel = process.env.COMFYUI_WAN_CLIP || "umt5_xxl_fp8_e4m3fn_scaled.safetensors";

  const lx2vLora = process.env.COMFYUI_GLTCH_LX2V_LORA
    || "wan_loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors";
  const lx2vHighStr = Number(process.env.COMFYUI_GLTCH_LX2V_HIGH_STR) || 5.6;
  const lx2vLowStr = Number(process.env.COMFYUI_GLTCH_LX2V_LOW_STR) || 2.0;

  const pusaHighLora = process.env.COMFYUI_GLTCH_PUSA_HIGH_LORA
    || "wan_loras/Wan22_PusaV1_lora_HIGH_resized_dynamic_avg_rank_98_bf16.safetensors";
  const pusaLowLora = process.env.COMFYUI_GLTCH_PUSA_LOW_LORA
    || "wan_loras/Wan22_PusaV1_lora_LOW_resized_dynamic_avg_rank_98_bf16.safetensors";
  const pusaHighStr = Number(process.env.COMFYUI_GLTCH_PUSA_HIGH_STR) || 1.5;
  const pusaLowStr = Number(process.env.COMFYUI_GLTCH_PUSA_LOW_STR) || 1.4;

  let highModelSource: [string, number] = ["40", 0];
  let lowModelSource: [string, number] = ["41", 0];

  const workflow: Record<string, any> = {
    "1": {
      class_type: "CLIPLoader",
      inputs: { clip_name: clipModel, type: "wan", device: "default" },
    },
    "7": {
      class_type: "VAELoader",
      inputs: { vae_name: "wan_2.1_vae.safetensors" },
    },
    "129": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
    "94": {
      class_type: "ImageResizeKJv2",
      inputs: {
        image: ["129", 0],
        width: p.resolution,
        height: p.resolution,
        upscale_method: "lanczos",
        keep_proportion: "resize",
        pad_color: "0, 0, 0",
        crop_position: "center",
        divisible_by: 16,
        device: "cpu",
      },
    },
    "128": {
      class_type: "easy cleanGpuUsed",
      inputs: { anything: ["94", 0] },
    },
    "13": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 0], text: p.prompt },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 0], text: p.negativePrompt },
    },
    "10": {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["13", 0],
        negative: ["6", 0],
        vae: ["7", 0],
        start_image: ["128", 0],
        width: ["94", 1],
        height: ["94", 2],
        length: p.frameCount,
        batch_size: 1,
      },
    },
    "121": {
      class_type: "easy seed",
      inputs: { seed: p.seed },
    },

    // ── GGUF Model Loading ──
    "29": {
      class_type: "UnetLoaderGGUF",
      inputs: { unet_name: highGguf },
    },
    "30": {
      class_type: "UnetLoaderGGUF",
      inputs: { unet_name: lowGguf },
    },

    // ── Lightx2v acceleration LoRAs ──
    "19": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["29", 0], lora_name: lx2vLora, strength_model: lx2vHighStr },
    },
    "20": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["30", 0], lora_name: lx2vLora, strength_model: lx2vLowStr },
    },

    // ── Pusa enhanced motions LoRAs ──
    "40": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["19", 0], lora_name: pusaHighLora, strength_model: pusaHighStr },
    },
    "41": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["20", 0], lora_name: pusaLowLora, strength_model: pusaLowStr },
    },
  };

  // ── Optional user video LoRA ──
  const isPaired = !!(p.videoLoraHigh && p.videoLoraLow);
  const hasHigh = isPaired || p.videoLoraHigh || (p.videoLora && (p.videoLoraPass === "high" || p.videoLoraPass === "both"));
  const hasLow = isPaired || p.videoLoraLow || (p.videoLora && (p.videoLoraPass === "low" || p.videoLoraPass === "both"));
  const loraStr = p.videoLoraStrength ?? 0.8;

  if (hasHigh) {
    workflow["42"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: highModelSource, lora_name: p.videoLoraHigh || p.videoLora!, strength_model: loraStr },
    };
    highModelSource = ["42", 0];
  }
  if (hasLow) {
    workflow["44"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: lowModelSource, lora_name: p.videoLoraLow || p.videoLora!, strength_model: loraStr },
    };
    lowModelSource = ["44", 0];
  }

  // ── SageAttention + model patches ──
  workflow["21"] = {
    class_type: "PathchSageAttentionKJ",
    inputs: { model: highModelSource, sage_attention: "auto", allow_compile: false },
  };
  workflow["33"] = {
    class_type: "ModelPatchTorchSettings",
    inputs: { model: ["21", 0], enable_fp16_accumulation: true },
  };
  workflow["32"] = {
    class_type: "PatchModelPatcherOrder",
    inputs: { model: ["33", 0], patch_order: "weight_patch_first", full_load: "auto" },
  };
  workflow["36"] = {
    class_type: "PathchSageAttentionKJ",
    inputs: { model: lowModelSource, sage_attention: "auto", allow_compile: false },
  };
  workflow["35"] = {
    class_type: "ModelPatchTorchSettings",
    inputs: { model: ["36", 0], enable_fp16_accumulation: true },
  };
  workflow["34"] = {
    class_type: "PatchModelPatcherOrder",
    inputs: { model: ["35", 0], patch_order: "weight_patch_first", full_load: "auto" },
  };

  // ── ModelSamplingSD3 shift scheduling ──
  workflow["8"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: ["32", 0], shift: 8 },
  };
  workflow["9"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: ["34", 0], shift: 8 },
  };

  // ── Stage 1: High noise + Lightx2v + Pusa ──
  workflow["31"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["8", 0],
      positive: ["10", 0],
      negative: ["10", 1],
      latent_image: ["10", 2],
      add_noise: "enable",
      noise_seed: ["121", 0],
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: "euler",
      scheduler: "simple",
      start_at_step: 0,
      end_at_step: splitStep,
      return_with_leftover_noise: "enable",
    },
  };
  workflow["72"] = {
    class_type: "UnloadModel",
    inputs: { value: ["31", 0], model: ["8", 0] },
  };

  // ── Stage 2: Low noise + Lightx2v + Pusa ──
  workflow["2"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["9", 0],
      positive: ["10", 0],
      negative: ["10", 1],
      latent_image: ["72", 0],
      add_noise: "disable",
      noise_seed: ["121", 0],
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: "euler",
      scheduler: "simple",
      start_at_step: splitStep,
      end_at_step: 10000,
      return_with_leftover_noise: "disable",
    },
  };
  workflow["74"] = {
    class_type: "UnloadModel",
    inputs: { value: ["2", 0], model: ["9", 0] },
  };

  // ── VAE Decode ──
  workflow["4"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["74", 0], vae: ["7", 0] },
  };

  // MMAudio ambient sound generation (optional)
  const audioMode = p.audioMode || "none";
  let audioNodeId: string | undefined;
  if (audioMode === "ambient") {
    audioNodeId = addMMAudioNodes(workflow, "4", p.seed, p.audioPrompt || p.prompt);
  }

  // ── Base video output (16fps) ──
  workflow["16"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["4", 0],
      frame_rate: 16,
      loop_count: 0,
      filename_prefix: "GltchWAN",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      ...(audioNodeId ? { audio: [audioNodeId, 0] } : {}),
    },
  };

  // ── Optional post-processing: ColorMatch → RealESRGAN 2x → RIFE 4x (60fps) ──
  if (p.useUpscale) {
    workflow["83"] = {
      class_type: "ColorMatch",
      inputs: {
        image_ref: ["129", 0],
        image_target: ["4", 0],
        method: "reinhard",
        strength: 0.4,
        multithread: true,
      },
    };
    workflow["84"] = {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: "RealESRGAN_x2plus.pth" },
    };
    workflow["80"] = {
      class_type: "ImageUpscaleWithModel",
      inputs: { upscale_model: ["84", 0], image: ["83", 0] },
    };
    workflow["81"] = {
      class_type: "RIFE VFI",
      inputs: {
        frames: ["80", 0],
        ckpt_name: "rife49.pth",
        clear_cache_after_n_frames: 16,
        multiplier: 4,
        fast_mode: false,
        ensemble: true,
        scale_factor: 1,
      },
    };
    workflow["85"] = {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["81", 0],
        frame_rate: 60,
        loop_count: 0,
        filename_prefix: "GltchWAN-HD",
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf: 19,
        save_metadata: true,
        trim_to_audio: false,
        pingpong: false,
        save_output: true,
        ...(audioNodeId ? { audio: [audioNodeId, 0] } : {}),
      },
    };
  }

  return workflow;
}

/**
 * LongLook Multi-Clip WAN 2.2 workflow (API format).
 *
 * Uses actual LongLook custom nodes (github.com/shootthesound/comfyUI-LongLook):
 * - WanFreeLong: Spectral blending for motion consistency within each 81-frame chunk
 * - WanMotionScale: Temporal RoPE scaling to reduce slomo (scale_t > 1 = faster motion)
 * - WanContinuationConditioning: Proper VAE-re-encoded last-frame chaining between clips
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
  motionScale?: number;
  videoLora?: string;
  videoLoraHigh?: string;
  videoLoraLow?: string;
  videoLoraStrength?: number;
  videoLoraPass?: "high" | "low" | "both";
  audioMode?: "none" | "ambient";
  audioPrompt?: string;
}): Record<string, any> {
  const halfSteps = Math.max(1, Math.floor(p.steps / 2));
  const seqCount = Math.min(4, Math.max(1, p.prompts.length));

  const workflow: Record<string, any> = {};

  // ── Shared nodes (built once) ──

  // CLIPLoader — offload to CPU to save ~8GB VRAM for the dual UNets
  workflow["10"] = {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      type: "wan",
      device: "cpu",
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
      weight_dtype: "fp8_e4m3fn",
    },
  };

  // Low noise diffusion model
  workflow["13"] = {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
      weight_dtype: "fp8_e4m3fn",
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

  // ModelSamplingSD3 — shift 12 matches the proven WAN Remix workflow
  workflow["22"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: highModelSource, shift: 12 },
  };
  workflow["23"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: lowModelSource, shift: 12 },
  };

  // WanFreeLong — spectral blending for motion consistency (the core LongLook feature)
  let highFinal: [string, number] = ["22", 0];
  let lowFinal: [string, number] = ["23", 0];

  workflow["30"] = {
    class_type: "WanFreeLong",
    inputs: {
      model: highFinal,
      enabled: true,
      blend_strength: 0.8,
      low_freq_ratio: 0.8,
      local_window_frames: 33,
      blend_start_block: 0,
      blend_end_block: -1,
    },
  };
  highFinal = ["30", 0];

  workflow["31"] = {
    class_type: "WanFreeLong",
    inputs: {
      model: lowFinal,
      enabled: true,
      blend_strength: 0.8,
      low_freq_ratio: 0.8,
      local_window_frames: 33,
      blend_start_block: 0,
      blend_end_block: -1,
    },
  };
  lowFinal = ["31", 0];

  // WanMotionScale — reduce slomo / pack more motion (scale_t > 1 = faster)
  const motionT = p.motionScale ?? 1.5;
  if (motionT !== 1.0) {
    workflow["32"] = {
      class_type: "WanMotionScale",
      inputs: { model: highFinal, enabled: true, scale_t: motionT },
    };
    highFinal = ["32", 0];

    workflow["33"] = {
      class_type: "WanMotionScale",
      inputs: { model: lowFinal, enabled: true, scale_t: motionT },
    };
    lowFinal = ["33", 0];
  }

  // Upscale flag — we use built-in lanczos scaling (no external model needed)

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

    // Text encoding
    const posNode = `${base}`;
    workflow[posNode] = {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["10", 0], text: promptText },
    };

    const negNode = `${base + 1}`;
    workflow[negNode] = {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["10", 0], text: p.negativePrompt },
    };

    // Conditioning — seq 0 uses WanImageToVideo, seq 1+ uses WanContinuationConditioning
    const condNode = `${base + 3}`;

    if (i === 0) {
      // First sequence: resize start image → standard i2v conditioning
      const resizeNode = `${base + 2}`;
      workflow[resizeNode] = {
        class_type: "ImageResizeKJ",
        inputs: {
          image: ["25", 0],
          width: p.width,
          height: p.height,
          upscale_method: "lanczos",
          keep_proportion: true,
          divisible_by: 16,
        },
      };

      workflow[condNode] = {
        class_type: "WanImageToVideo",
        inputs: {
          positive: [posNode, 0],
          negative: [negNode, 0],
          vae: ["11", 0],
          start_image: [resizeNode, 0],
          width: [resizeNode, 1],
          height: [resizeNode, 2],
          length: p.frameCount,
          batch_size: 1,
        },
      };
    } else {
      // Continuation: WanContinuationConditioning extracts last frame from previous
      // VAEDecode output, VAE-re-encodes it, and handles resizing internally.
      // Use the first sequence's resize node for consistent dimensions.
      const prevDecodeNode = `${1000 + (i - 1) * 100 + 6}`;
      const firstResizeNode = "1002";
      workflow[condNode] = {
        class_type: "WanContinuationConditioning",
        inputs: {
          positive: [posNode, 0],
          negative: [negNode, 0],
          anchor_images: [prevDecodeNode, 0],
          vae: ["11", 0],
          width: [firstResizeNode, 1],
          height: [firstResizeNode, 2],
          video_length: p.frameCount,
        },
      };
    }

    // KSamplerAdvanced (high noise pass — uses FreeLong-patched model)
    const highSampler = `${base + 4}`;
    workflow[highSampler] = {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: highFinal,
        positive: [condNode, 0],
        negative: [condNode, 1],
        latent_image: [condNode, 2],
        add_noise: "enable",
        noise_seed: p.seed + i,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "uni_pc",
        scheduler: "beta",
        start_at_step: 0,
        end_at_step: halfSteps,
        return_with_leftover_noise: "enable",
      },
    };

    // VRAM cleanup between passes
    const vramNode = `${base + 10}`;
    workflow[vramNode] = {
      class_type: "VRAM_Debug",
      inputs: {
        any_input: [highSampler, 0],
        empty_cache: true,
        gc_collect: true,
        unload_all_models: false,
      },
    };

    // KSamplerAdvanced (low noise pass)
    const lowSampler = `${base + 5}`;
    workflow[lowSampler] = {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: lowFinal,
        positive: [condNode, 0],
        negative: [condNode, 1],
        latent_image: [vramNode, 0],
        add_noise: "disable",
        noise_seed: 0,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: "uni_pc",
        scheduler: "beta",
        start_at_step: halfSteps,
        end_at_step: p.steps,
        return_with_leftover_noise: "disable",
      },
    };

    // VAEDecode — raw output used for both continuation AND post-processing
    const decodeNode = `${base + 6}`;
    workflow[decodeNode] = {
      class_type: "VAEDecode",
      inputs: { samples: [lowSampler, 0], vae: ["11", 0] },
    };

    // Sharpen after VAE decode (same as WAN video workflow)
    const sharpenNode = `${base + 7}`;
    workflow[sharpenNode] = {
      class_type: "FastUnsharpSharpen",
      inputs: { images: [decodeNode, 0], strength: 0.5, disable: false, use_gpu: true },
    };

    let seqLastNode = sharpenNode;
    let seqLastOut = 0;

    if (p.useRife) {
      const rifeNode = `${base + 8}`;
      workflow[rifeNode] = {
        class_type: "RIFE VFI",
        inputs: {
          frames: [seqLastNode, seqLastOut],
          ckpt_name: "rife47.pth",
          clear_cache_after_n_frames: 10,
          multiplier: 2,
          fast_mode: true,
          ensemble: false,
          scale_factor: 1,
        },
      };
      seqLastNode = rifeNode;
      seqLastOut = 0;
    }

    if (p.useUpscale) {
      const upscaleNode = `${base + 9}`;
      workflow[upscaleNode] = {
        class_type: "ImageScaleBy",
        inputs: { image: [seqLastNode, seqLastOut], upscale_method: "lanczos", scale_by: 2.0 },
      };
      seqLastNode = upscaleNode;
      seqLastOut = 0;
    }

    seqOutputNodes.push(seqLastNode);
  }

  // ── Final output nodes (use same CreateVideo + SaveVideo as WAN video) ──

  const fps = p.useRife ? 48 : 24;

  let finalFrames: [string, number];

  if (seqCount === 1) {
    finalFrames = [seqOutputNodes[0], 0];
  } else {
    // Multiple sequences — combine frames with ImageBatchMulti
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
    finalFrames = ["899", 0];
  }

  // MMAudio ambient sound generation (optional)
  const audioMode = p.audioMode || "none";
  let audioNodeId: string | undefined;
  if (audioMode === "ambient") {
    audioNodeId = addMMAudioNodes(workflow, finalFrames[0], p.seed, p.audioPrompt || p.prompts[0]);
  }

  // Encode frames → video with quality control
  workflow["901"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: finalFrames,
      frame_rate: fps,
      loop_count: 0,
      filename_prefix: "GrokRunner_LongLook",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      ...(audioNodeId ? { audio: [audioNodeId, 0] } : {}),
    },
  };

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
/**
 * Z-Image Turbo txt2img workflow.
 * 6B param distilled model — 8 steps, CFG 1.0, sgm_uniform scheduler.
 * Uses split loaders: UNETLoader + CLIPLoader + VAELoader.
 */
function buildZimageTurboWorkflow(p: {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  steps?: number;
  cfg?: number;
}): Record<string, any> {
  const unet = process.env.COMFYUI_ZIMAGE_UNET || "z_image_turbo_bf16.safetensors";
  const clip = process.env.COMFYUI_ZIMAGE_CLIP || "qwen_3_4b.safetensors";
  const vae = process.env.COMFYUI_ZIMAGE_VAE || "ae.safetensors";

  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: unet, weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: clip, type: "ltxv" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: vae },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: p.prompt, clip: ["2", 0] },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["2", 0] },
    },
    "6": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: 1 },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        seed: p.seed,
        steps: p.steps || 8,
        cfg: p.cfg || 1.0,
        sampler_name: "euler_ancestral",
        scheduler: "sgm_uniform",
        denoise: 1,
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["3", 0] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "GLTCH-ZImage", images: ["8", 0] },
    },
  };
}

const TXT2IMG_DEFAULT_NEGATIVE =
  "cgi, 3d render, cartoon, anime, illustration, drawing, painting, sketch, plastic skin, smooth skin, airbrushed, doll-like, mannequin, blurry, low quality, worst quality, jpeg artifacts, deformed, bad anatomy, bad proportions, extra limbs, missing limbs, disfigured, ugly, watermark, text, signature, cropped";

const QWEN_DEFAULT_NEGATIVE =
  "smooth skin, plastic skin, waxy skin, cgi, 3d render, airbrushed, doll-like, mannequin, fake, cartoon, anime, illustration, drawing, painting, sketch, over-processed, over-smoothed, blurry, low quality, deformed, bad anatomy, bad proportions, extra limbs, disfigured, ugly, watermark, text, signature";

function buildQwenEditWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  imageFilename2?: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  sampler?: string;
  scheduler?: string;
  checkpoint: string;
  vae?: string;
  upscale?: boolean;
  loras?: { name: string; strengthModel: number; strengthClip: number }[];
}): Record<string, any> {
  const activeLoras = (p.loras || []).filter(l => l.name && l.name !== "none");

  const ckptModel: [string, number] = ["125", 0];
  const ckptClip: [string, number] = ["125", 1];
  let modelSource: [string, number] = ckptModel;
  let clipSource: [string, number] = ckptClip;

  const vaeSource: [string, number] = p.vae ? ["130", 0] : ["125", 2];

  const workflow: Record<string, any> = {
    "125": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: p.checkpoint },
    },
    "123": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
  };

  if (p.imageFilename2) {
    workflow["124"] = {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename2 },
    };
  }

  if (p.vae) {
    workflow["130"] = {
      class_type: "VAELoader",
      inputs: { vae_name: p.vae },
    };
  }

  for (let i = 0; i < activeLoras.length; i++) {
    const nodeId = String(10 + i);
    workflow[nodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: activeLoras[i].name,
        strength_model: activeLoras[i].strengthModel,
        strength_clip: activeLoras[i].strengthClip,
        model: modelSource,
        clip: clipSource,
      },
    };
    modelSource = [nodeId, 0];
    clipSource = [nodeId, 1];
  }

  // Primary image → image2, optional second image → image1 (matches GLTCH workflow)
  const positiveInputs: Record<string, any> = {
    clip: clipSource,
    vae: vaeSource,
    image2: ["123", 0],
    prompt: p.prompt,
  };
  if (p.imageFilename2) {
    positiveInputs.image1 = ["124", 0];
  }

  Object.assign(workflow, {
    "132": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: positiveInputs,
    },
    "133": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ckptClip,
        vae: vaeSource,
        prompt: p.negativePrompt,
      },
    },
    "148": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: 1 },
    },
    "75": {
      class_type: "KSampler",
      inputs: {
        model: modelSource,
        positive: ["132", 0],
        negative: ["133", 0],
        latent_image: ["148", 0],
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: p.sampler || "sa_solver",
        scheduler: p.scheduler || "beta",
        denoise: 1,
      },
    },
    "73": {
      class_type: "VAEDecode",
      inputs: { samples: ["75", 0], vae: vaeSource },
    },
    "77": {
      class_type: "SaveImage",
      inputs: { images: ["73", 0], filename_prefix: "GrokRunner" },
    },
  });

  if (p.upscale) {
    workflow["128"] = {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: "4x-UltraSharp.pth" },
    };
    workflow["126"] = {
      class_type: "UltimateSDUpscale",
      inputs: {
        image: ["73", 0],
        model: modelSource,
        positive: ["132", 0],
        negative: ["133", 0],
        vae: vaeSource,
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
    };
    workflow["200"] = {
      class_type: "SaveImage",
      inputs: { images: ["126", 0], filename_prefix: "GrokRunner_HD" },
    };
  }

  return workflow;
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
  const result = (await resp.json()) as any;
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
        const qwenLorasEnv = process.env.COMFYUI_QWEN_LORAS || "";
        const qwenLoras = qwenLorasEnv
          ? qwenLorasEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : [];
        return res.status(200).json({ checkpoints, loras, videoLoras, qwenLoras });
      } else {
        const resp = await fetch(
          `${backend.comfyUrl}/object_info/CheckpointLoaderSimple`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!resp.ok) throw new Error(`ComfyUI returned ${resp.status}`);
        const info = (await resp.json()) as any;
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
            const loraInfo = (await loraResp.json()) as any;
            loras = loraInfo?.LoraLoader?.input?.required?.lora_name?.[0] || [];
          }
        } catch { /* best effort */ }
        // For local mode, video LoRAs are in the same lora folder
        const videoLorasEnv = process.env.COMFYUI_VIDEO_LORAS || "";
        const videoLoraFiles = videoLorasEnv
          ? videoLorasEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : [];
        const videoLoras = groupVideoLoras(videoLoraFiles);
        const qwenLorasEnv = process.env.COMFYUI_QWEN_LORAS || "";
        const qwenLoras = qwenLorasEnv
          ? qwenLorasEnv.split(",").map((m) => m.trim()).filter(Boolean)
          : [];
        return res.status(200).json({ checkpoints, loras, videoLoras, qwenLoras });
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
        loras,
        loraStrength = 0.8,
        imageBase64,
        imageFilename: clientFilename,
        imageBase64_2,
        imageFilename2: clientFilename2,
        upscale,
        sampler,
        scheduler,
        frameCount = 81,
        useRife = false,
        useUpscale: useVidUpscale = false,
        videoLora,
        videoLoraStrength = 0.8,
        videoLoraPass = "both",
        sequenceCount = 2,
        motionScale,
        audioMode = "none",
        audioPrompt,
      } = req.body;

      if (!prompt)
        return res.status(400).json({ error: "Prompt is required" });
      // Checkpoint is required for txt2img only; qwen-edit and wan-video use fixed models
      if (workflowType === "txt2img" && !checkpoint)
        return res.status(400).json({ error: "Checkpoint is required" });

      // ── Credit gate (admin is free unless testCredits is set) ──
      // skipCredits: client passes true for the first step of a chained workflow
      // (e.g. txt2img as part of text-to-video — the video step pays for both)
      const skipCredits = req.body.skipCredits === true;
      const adminTestCredits = isAdminUser && req.body.testCredits === true;
      const costKey = workflowType === "qwen-edit" && upscale ? "qwen-edit-hd"
        : workflowType === "gltch-wan" && useVidUpscale ? "gltch-wan-hd"
          : workflowType;
      const baseCost = COMFY_COSTS[costKey] ?? 1;
      const audioCost = audioMode === "ambient" ? 1 : 0;
      const cost = skipCredits ? 0 : (workflowType === "longlook" ? baseCost * Math.min(4, Math.max(1, Number(sequenceCount))) + audioCost : baseCost + audioCost);
      let creditDeducted = false;

      if (!isAdminUser || adminTestCredits) {
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
      const clampSteps = Math.min(100, Math.max(1, Number(steps) || 8));
      const clampCfg = Math.min(30, Math.max(0.1, Number(cfg) || 1));

      // Workflows that need a start image
      const needsImage = workflowType === "qwen-edit" || workflowType === "wan-video" || workflowType === "gltch-wan" || workflowType === "longlook";

      // Determine image filename for workflow
      let imageFilename: string | undefined;
      let imageFilename2: string | undefined;

      if (needsImage) {
        if (!imageBase64 && !clientFilename) {
          return res.status(400).json({ error: `Image is required for ${workflowType}` });
        }

        if (backend.mode === "runpod") {
          imageFilename = clientFilename || `input_${workflowType}_${Date.now()}.jpg`;
          if (imageBase64_2 || clientFilename2) {
            imageFilename2 = clientFilename2 || `input_${workflowType}_2_${Date.now()}.jpg`;
          }
          console.log(`[comfyui] images: primary=${imageFilename} (${imageBase64 ? Math.round(imageBase64.length / 1024) + 'KB' : 'none'}), second=${imageFilename2 || 'none'} (${imageBase64_2 ? Math.round(imageBase64_2.length / 1024) + 'KB' : 'none'})`);
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
          if (imageBase64_2) {
            imageFilename2 = await uploadImageToLocal(
              backend.comfyUrl!,
              imageBase64_2,
              clientFilename2 || `input_${workflowType}_2_${Date.now()}.jpg`,
            );
          } else if (clientFilename2) {
            imageFilename2 = clientFilename2;
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
          audioMode: (["none", "ambient"].includes(audioMode) ? audioMode : "none") as "none" | "ambient",
          audioPrompt: audioPrompt || undefined,
        });
      } else if (workflowType === "gltch-wan") {
        const resolution = Math.min(1280, Math.max(480, Number(req.body.resolution) || 832));

        let resolvedGltchLora: string | undefined;
        let resolvedGltchLoraHigh: string | undefined;
        let resolvedGltchLoraLow: string | undefined;
        if (videoLora) {
          const videoLoraFiles = (process.env.COMFYUI_VIDEO_LORAS || "")
            .split(",").map((m: string) => m.trim()).filter(Boolean);
          const grouped = groupVideoLoras(videoLoraFiles);
          const match = grouped.find((g) => g.name === videoLora);
          if (match) {
            if (match.high && match.low) {
              resolvedGltchLoraHigh = match.high;
              resolvedGltchLoraLow = match.low;
            } else if (match.single) {
              resolvedGltchLora = match.single;
            } else {
              resolvedGltchLoraHigh = match.high;
              resolvedGltchLoraLow = match.low;
            }
          } else {
            resolvedGltchLora = videoLora;
          }
        }

        workflow = buildGltchWanWorkflow({
          prompt: prompt.trim(),
          negativePrompt: (negativePrompt || "").trim() || WAN_DEFAULT_NEGATIVE,
          imageFilename: imageFilename!,
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
          frameCount: Math.min(241, Math.max(17, Number(frameCount))),
          resolution,
          useUpscale: !!useVidUpscale,
          videoLora: resolvedGltchLora,
          videoLoraHigh: resolvedGltchLoraHigh,
          videoLoraLow: resolvedGltchLoraLow,
          videoLoraStrength: Number(videoLoraStrength),
          videoLoraPass: (["high", "low", "both"].includes(videoLoraPass) ? videoLoraPass : "both") as "high" | "low" | "both",
          audioMode: (["none", "ambient"].includes(audioMode) ? audioMode : "none") as "none" | "ambient",
          audioPrompt: audioPrompt || undefined,
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

        const llmData = (await llmResp.json()) as any;
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
          motionScale: motionScale != null ? Number(motionScale) : undefined,
          videoLora: resolvedVideoLora2,
          videoLoraHigh: resolvedVideoLoraHigh2,
          videoLoraLow: resolvedVideoLoraLow2,
          videoLoraStrength: Number(videoLoraStrength),
          videoLoraPass: (["high", "low", "both"].includes(videoLoraPass) ? videoLoraPass : "both") as "high" | "low" | "both",
          audioMode: (["none", "ambient"].includes(audioMode) ? audioMode : "none") as "none" | "ambient",
          audioPrompt: audioPrompt || undefined,
        });
      } else if (workflowType === "qwen-edit") {
        // Qwen edit always uses the Qwen checkpoint — ignore client checkpoint
        const qwenCkpt = process.env.COMFYUI_QWEN_MODEL || "Qwen-Rapid-AIO-v2.safetensors";
        // Auto-inject facial preservation hint for better likeness
        const enhancedPrompt = prompt.trim().toLowerCase().includes("preserve facial")
          ? prompt.trim()
          : `${prompt.trim()}, preserve facial features, maintain high likeness`;
        let qwenLoraList: { name: string; strengthModel: number; strengthClip: number }[] = [];
        if (Array.isArray(loras) && loras.length > 0) {
          qwenLoraList = loras
            .filter((l: any) => l.name && l.name !== "none")
            .map((l: any) => ({
              name: String(l.name),
              strengthModel: Number(l.strengthModel ?? l.strength) || 0.8,
              strengthClip: Number(l.strengthClip ?? l.strength) || 0.8,
            }));
        } else if (lora && lora !== "none") {
          const s = Number(loraStrength) || 0.8;
          qwenLoraList = [{ name: lora, strengthModel: s, strengthClip: s }];
        }

        // Only use external VAE if explicitly set (fp8 checkpoints strip the VAE)
        const qwenVae = process.env.COMFYUI_QWEN_VAE || "";

        workflow = buildQwenEditWorkflow({
          prompt: enhancedPrompt,
          negativePrompt: (negativePrompt || "").trim() || QWEN_DEFAULT_NEGATIVE,
          imageFilename: imageFilename!,
          imageFilename2: imageFilename2 || undefined,
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
          sampler: sampler || undefined,
          scheduler: scheduler || undefined,
          checkpoint: qwenCkpt,
          vae: qwenVae,
          upscale: !!upscale,
          loras: qwenLoraList,
        });
      } else if (workflowType === "zimage") {
        workflow = buildZimageTurboWorkflow({
          prompt: prompt.trim(),
          width: clampW,
          height: clampH,
          seed: actualSeed,
          steps: clampSteps,
          cfg: clampCfg,
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
      const isVideoWorkflow = workflowType === "wan-video" || workflowType === "gltch-wan" || workflowType === "longlook";
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
          if (imageBase64_2 && imageFilename2) {
            runpodInput.images.push({
              name: imageFilename2,
              image: imageBase64_2,
            });
          }
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
            await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`.catch(() => { });
          }
          throw new Error(`RunPod submit failed (${resp.status}): ${errText}`);
        }

        const result = (await resp.json()) as any;

        // Log usage
        if (!isAdminUser || adminTestCredits) {
          const sql = getDb();
          const logMode = `comfy-${workflowType}`;
          await sql`
            INSERT INTO usage_log (user_id, mode, credits_used, prompt)
            VALUES (${auth.userId}::uuid, ${logMode}, ${cost}, ${(prompt || "").slice(0, 500)})
          `.catch(() => { });
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
            await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`.catch(() => { });
          }
          throw new Error(`ComfyUI prompt failed (${resp.status}): ${errText}`);
        }

        const result = (await resp.json()) as any;

        if (!isAdminUser || adminTestCredits) {
          const sql = getDb();
          const logMode = `comfy-${workflowType}`;
          await sql`
            INSERT INTO usage_log (user_id, mode, credits_used, prompt)
            VALUES (${auth.userId}::uuid, ${logMode}, ${cost}, ${(prompt || "").slice(0, 500)})
          `.catch(() => { });
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
          const out = data.output || {};
          console.log("[comfyui-poll] COMPLETED output keys:", Object.keys(out));

          // Helper: detect S3/HTTP URLs vs base64, return appropriate URI.
          // Uses AWS SDK with credentials (RunPod S3 doesn't support presigned URL auth).
          // Images → base64 (small). Videos → S3 URL for streaming proxy.
          async function resolveFileData(file: any, type: "video" | "image"): Promise<string | null> {
            const d = typeof file === "string" ? file : (file?.data || file?.url || null);
            if (!d || typeof d !== "string") return null;
            // Already a data URI
            if (d.startsWith("data:")) return d;
            // S3 URL or any HTTP URL
            if (d.startsWith("http://") || d.startsWith("https://") || file?.type === "s3_url" || file?.type === "url") {
              const url = d.startsWith("http") ? d : (file?.url || d);
              // Download via S3 SDK (RunPod S3 doesn't support presigned URL auth)
              const s3Data = await downloadFromS3(url);
              if (s3Data) {
                const base64 = s3Data.buffer.toString("base64");
                return `data:${s3Data.contentType};base64,${base64}`;
              }
              // Fallback: return URL as-is (logs the error in downloadFromS3)
              console.error(`[comfyui-poll] S3 download failed for ${type}, returning URL as fallback`);
              return url;
            }
            // Raw base64
            if (d.length > 100) {
              const mime = type === "video" ? "video/mp4" : "image/png";
              return `data:${mime};base64,${d}`;
            }
            return null;
          }

          // Scan all file arrays in output (videos, gifs, images) at top level and nested
          async function findOutput(obj: any): Promise<{ uri: string; type: "video" | "image" } | null> {
            if (!obj || typeof obj !== "object") return null;

            // Check standard arrays at this level
            for (const arrKey of ["videos", "gifs", "images"]) {
              const arr = obj[arrKey];
              if (!Array.isArray(arr) || !arr.length) continue;
              const file = arr[arr.length - 1];
              const isVid = arrKey !== "images" || outputType === "video";
              const uri = await resolveFileData(file, isVid ? "video" : "image");
              if (uri) return { uri, type: isVid ? "video" : "image" };
            }

            // Check message field
            if (typeof obj.message === "string" && obj.message.length > 50) {
              const uri = await resolveFileData(obj.message, outputType === "video" ? "video" : "image");
              if (uri) return { uri, type: outputType === "video" ? "video" : "image" };
            }

            return null;
          }

          // Try top-level output first
          const topResult = await findOutput(out);
          if (topResult) {
            return res.status(200).json({ status: "done", [topResult.type]: topResult.uri });
          }

          // Deep scan: check nested node objects
          for (const key of Object.keys(out)) {
            const node = out[key];
            if (!node || typeof node !== "object") {
              // Direct string value
              if (typeof node === "string" && node.length > 100) {
                const uri = await resolveFileData(node, outputType === "video" ? "video" : "image");
                if (uri) return res.status(200).json({ status: "done", [outputType === "video" ? "video" : "image"]: uri });
              }
              continue;
            }
            const nested = await findOutput(node);
            if (nested) {
              console.log(`[comfyui-poll] Found output in nested key "${key}"`);
              return res.status(200).json({ status: "done", [nested.type]: nested.uri });
            }
          }

          // If output exists but has no extractable data
          const outStr = JSON.stringify(out);
          console.error("[comfyui-poll] No output found. Keys:", Object.keys(out), "Size:", outStr.length, "Preview:", outStr.slice(0, 1000));
          return res.status(200).json({ status: "error", error: "Job completed but no output could be extracted. The video may be too large for the response." });
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

    // ========== S3-TEST (diagnostic to verify S3 connectivity) ==========
    if (action === "s3-test") {
      const endpoint = process.env.RUNPOD_S3_ENDPOINT;
      const accessKey = process.env.RUNPOD_S3_ACCESS_KEY;
      const secretKey = process.env.RUNPOD_S3_SECRET_KEY;
      const bucket = process.env.RUNPOD_S3_BUCKET;
      const missingVars = [];
      if (!endpoint) missingVars.push("RUNPOD_S3_ENDPOINT");
      if (!accessKey) missingVars.push("RUNPOD_S3_ACCESS_KEY");
      if (!secretKey) missingVars.push("RUNPOD_S3_SECRET_KEY");
      if (!bucket) missingVars.push("RUNPOD_S3_BUCKET");

      if (missingVars.length > 0) {
        return res.status(200).json({
          ok: false,
          error: `Missing env vars: ${missingVars.join(", ")}`,
          hint: "Set these in your Vercel/Netlify environment settings and redeploy.",
        });
      }

      // Try listing the bucket
      try {
        const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
        const client = getS3Client();
        if (!client) return res.status(200).json({ ok: false, error: "S3 client creation failed" });
        const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 3 }));
        return res.status(200).json({
          ok: true,
          endpoint,
          bucket,
          objectCount: list.KeyCount,
          sampleKeys: list.Contents?.map(o => o.Key).slice(0, 3) || [],
        });
      } catch (err: any) {
        return res.status(200).json({
          ok: false,
          error: err.message,
          endpoint,
          bucket,
          accessKeyPrefix: accessKey?.slice(0, 10) + "...",
        });
      }
    }

    // ========== PROXY-S3 (download from S3 with proper auth for browser access) ==========
    if (action === "proxy-s3") {
      const { url } = req.body;
      if (!url || typeof url !== "string" || !url.startsWith("https://")) {
        return res.status(400).json({ error: "Valid HTTPS url is required" });
      }

      try {
        const s3Data = await downloadFromS3(url);
        if (!s3Data) {
          return res.status(502).json({ error: "Failed to download from S3. Check RUNPOD_S3_* env vars." });
        }

        res.setHeader("Content-Type", s3Data.contentType);
        res.setHeader("Content-Length", s3Data.buffer.byteLength);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(200);
        res.end(s3Data.buffer);

        // Fire-and-forget: delete the S3 object + its parent folder after delivery
        const parsed = parseS3Url(url);
        const s3Bucket = parsed?.bucket || process.env.RUNPOD_S3_BUCKET;
        const s3Key = parsed?.key;
        if (s3Bucket && s3Key) {
          const client = getS3Client();
          if (client) {
            (async () => {
              try {
                // Delete the specific file
                await client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: s3Key }));
                console.log(`[s3-cleanup] Deleted s3://${s3Bucket}/${s3Key}`);

                // Also delete the parent folder (RunPod creates UUID folders)
                const folder = s3Key.split("/").slice(0, -1).join("/");
                if (folder) {
                  const list = await client.send(new ListObjectsV2Command({ Bucket: s3Bucket, Prefix: folder + "/" }));
                  if (list.Contents && list.Contents.length > 0) {
                    await client.send(new DeleteObjectsCommand({
                      Bucket: s3Bucket,
                      Delete: { Objects: list.Contents.map(o => ({ Key: o.Key! })) },
                    }));
                    console.log(`[s3-cleanup] Cleaned folder ${folder}/ (${list.Contents.length} objects)`);
                  }
                }
              } catch (err: any) {
                console.error(`[s3-cleanup] Failed: ${err.message}`);
              }
            })();
          }
        }
        return;
      } catch (err: any) {
        return res.status(502).json({ error: `S3 proxy failed: ${err.message}` });
      }
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

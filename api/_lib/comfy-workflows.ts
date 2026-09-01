/**
 * ComfyUI workflow graphs shared by the app route and the public API.
 *
 * These used to live inside api/comfyui.ts, private to it, so api/v1/comfy.ts
 * carried its own hand-written copies of a few graphs and simply had no version
 * of the rest. That is why the public API offered txt2img, klein and wan-video
 * while the app ran gltch-wan and zimage — and why the API's list drifted away
 * from what people actually use: klein and gltch-wan alone are 97.6% of jobs.
 *
 * One definition, both callers. A graph fixed here is fixed in both places.
 */

/**
 * GLTCH WAN 2.2 I2V workflow — simple baseline fallback.
 *
 * Keeps the same GGUF + CLIPVision conditioning as the main GLTCH workflow,
 * but removes upscale/RIFE complexity so we can isolate native WAN motion.
 * This is the "known-simple" path used for standard GLTCH video generation.
 */
/**
 * Add MMAudio ambient audio nodes to a video workflow.
 * Injects nodes 200-202 (model + features + sampler) and returns the audio node ID.
 * The caller should pass the audio output to VHS_VideoCombine.
 */
export function addMMAudioNodes(
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

export function buildGltchWanSimpleWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  endImageFilename?: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  frameCount: number;
  resolution: number;
  shift?: number;
  videoLora?: string;
  videoLoraHigh?: string;
  videoLoraLow?: string;
  videoLoraStrength?: number;
  videoLoraPass?: "high" | "low" | "both";
  audioMode?: "none" | "ambient";
  audioPrompt?: string;
}): Record<string, any> {
  const splitStep = Math.max(1, Math.floor(p.steps / 2));
  const shift = p.shift ?? 8;

  const highModel = process.env.COMFYUI_GLTCH_HIGH_MODEL || "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8H.gguf";
  const lowModel = process.env.COMFYUI_GLTCH_LOW_MODEL || "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8L.gguf";
  const isGguf = highModel.endsWith(".gguf") || lowModel.endsWith(".gguf");
  const clipModel = process.env.COMFYUI_WAN_CLIP || "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
  const clipVisionModel = process.env.COMFYUI_WAN_CLIP_VISION || "clip_vision_h.safetensors";

  let highModelSource: [string, number] = ["29", 0];
  let lowModelSource: [string, number] = ["30", 0];

  const workflow: Record<string, any> = {
    "1": {
      class_type: "CLIPLoader",
      inputs: { clip_name: clipModel, type: "wan", device: "cpu" },
    },
    "7": {
      class_type: "VAELoader",
      inputs: { vae_name: "wan_2.1_vae.safetensors" },
    },
    "50": {
      class_type: "CLIPVisionLoader",
      inputs: { clip_name: clipVisionModel },
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
    "51": {
      class_type: "CLIPVisionEncode",
      inputs: {
        clip_vision: ["50", 0],
        image: ["129", 0],
        crop: "none",
      },
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
        clip_vision_output: ["51", 0],
        start_image: ["94", 0],
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
    "29": {
      class_type: isGguf ? "UnetLoaderGGUF" : "UNETLoader",
      inputs: isGguf ? { unet_name: highModel } : { unet_name: highModel, weight_dtype: "default" },
    },
    "30": {
      class_type: isGguf ? "UnetLoaderGGUF" : "UNETLoader",
      inputs: isGguf ? { unet_name: lowModel } : { unet_name: lowModel, weight_dtype: "default" },
    },
  };

  if (p.endImageFilename) {
    console.warn("[comfyui] end_image requested but disabled — worker ComfyUI too old. Ignoring end frame.");
  }

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

  workflow["8"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: highModelSource, shift },
  };
  workflow["9"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: lowModelSource, shift },
  };

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
  workflow["120"] = {
    class_type: "easy cleanGpuUsed",
    inputs: { anything: ["31", 0] },
  };
  workflow["2"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["9", 0],
      positive: ["10", 0],
      negative: ["10", 1],
      latent_image: ["120", 0],
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
  workflow["4"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["2", 0], vae: ["7", 0] },
  };

  const audioMode = p.audioMode || "none";
  let audioNodeId: string | undefined;
  if (audioMode === "ambient") {
    audioNodeId = addMMAudioNodes(workflow, "4", p.seed, p.audioPrompt || p.prompt);
  }

  workflow["16"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["4", 0],
      frame_rate: 12,
      loop_count: 0,
      filename_prefix: "GltchWAN-simple",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 18,
      save_metadata: false,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      ...(audioNodeId ? { audio: [audioNodeId, 0] } : {}),
    },
  };

  return workflow;
}

/**
 * GLTCH WAN 2.2 I2V workflow — SmoothMix Enhanced NSFW Lightning Edition.
 *
 * Uses SmoothMix_High / SmoothMix_Low safetensor checkpoints which have
 * Lightning LoRAs already baked in. Do NOT add extra Lightning LoRAs.
 *
 * Two-stage KSamplerAdvanced (euler_ancestral / simple):
 *   Stage 1: SmoothMix_High, cfg=1, steps 0→split
 *   Stage 2: SmoothMix_Low,  cfg=1, steps split→end
 *
 * Default 6 steps split 50/50 (3+3).
 * CLIPVision encoding for I2V conditioning (clip_vision_h.safetensors).
 * Post-processing: lanczos 2x upscale → RIFE 2x @ 32fps (matches reference workflow v2.0).
 */
export function buildGltchWanWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  endImageFilename?: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  frameCount: number;
  resolution: number;
  shift?: number;
  useUpscale?: boolean;
  videoLora?: string;
  videoLoraHigh?: string;
  videoLoraLow?: string;
  videoLoraStrength?: number;
  videoLoraPass?: "high" | "low" | "both";
  audioMode?: "none" | "ambient";
  audioPrompt?: string;
}): Record<string, any> {
  const splitStep = Math.max(1, Math.floor(p.steps / 2));
  const shift = p.shift ?? 8;

  const highModel = process.env.COMFYUI_GLTCH_HIGH_MODEL || "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8H.gguf";
  const lowModel = process.env.COMFYUI_GLTCH_LOW_MODEL || "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8L.gguf";
  const isGguf = highModel.endsWith(".gguf") || lowModel.endsWith(".gguf");
  const clipModel = process.env.COMFYUI_WAN_CLIP || "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
  const clipVisionModel = process.env.COMFYUI_WAN_CLIP_VISION || "clip_vision_h.safetensors";

  // Model sources — may be overridden by optional user LoRA nodes below
  let highModelSource: [string, number] = ["29", 0];
  let lowModelSource: [string, number] = ["30", 0];

  const workflow: Record<string, any> = {
    // ── CLIP text encoder ──
    "1": {
      class_type: "CLIPLoader",
      inputs: { clip_name: clipModel, type: "wan", device: "cpu" },
    },
    // ── VAE ──
    "7": {
      class_type: "VAELoader",
      inputs: { vae_name: "wan_2.1_vae.safetensors" },
    },
    // ── CLIPVision for I2V conditioning ──
    "50": {
      class_type: "CLIPVisionLoader",
      inputs: { clip_name: clipVisionModel },
    },
    // ── Load start image ──
    "129": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
    // ── Resize image to target resolution ──
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
    // ── CLIPVision encode (on original image for best quality) ──
    "51": {
      class_type: "CLIPVisionEncode",
      inputs: {
        clip_vision: ["50", 0],
        image: ["129", 0],
        crop: "none",
      },
    },
    // ── Positive prompt ──
    "13": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 0], text: p.prompt },
    },
    // ── Negative prompt ──
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 0], text: p.negativePrompt },
    },
    // ── WanImageToVideo conditioning (with CLIPVision) ──
    "10": {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["13", 0],
        negative: ["6", 0],
        vae: ["7", 0],
        clip_vision_output: ["51", 0],
        start_image: ["94", 0],
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

    // ── Model Loading (Lightning already baked in) ──
    "29": {
      class_type: isGguf ? "UnetLoaderGGUF" : "UNETLoader",
      inputs: isGguf ? { unet_name: highModel } : { unet_name: highModel, weight_dtype: "default" },
    },
    "30": {
      class_type: isGguf ? "UnetLoaderGGUF" : "UNETLoader",
      inputs: isGguf ? { unet_name: lowModel } : { unet_name: lowModel, weight_dtype: "default" },
    },
  };

  if (p.endImageFilename) {
    console.warn("[comfyui] end_image requested but disabled — worker ComfyUI too old. Ignoring end frame.");
  }

  // ── Optional user video LoRA (NOT Lightning — those are baked in) ──
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

  // ── ModelSamplingSD3 shift scheduling ──
  workflow["8"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: highModelSource, shift },
  };
  workflow["9"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: lowModelSource, shift },
  };

  // ── Stage 1: High noise (SmoothMix_High) ──
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

  // ── VRAM cleanup between passes ──
  workflow["120"] = {
    class_type: "easy cleanGpuUsed",
    inputs: { anything: ["31", 0] },
  };

  // ── Stage 2: Low noise (SmoothMix_Low) ──
  workflow["2"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["9", 0],
      positive: ["10", 0],
      negative: ["10", 1],
      latent_image: ["120", 0],
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

  // ── VAE Decode ──
  workflow["4"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["2", 0], vae: ["7", 0] },
  };

  // MMAudio ambient sound generation (optional)
  const audioMode = p.audioMode || "none";
  let audioNodeId: string | undefined;
  if (audioMode === "ambient") {
    audioNodeId = addMMAudioNodes(workflow, "4", p.seed, p.audioPrompt || p.prompt);
  }

  // ── Base 16fps output — NOT saved (RIFE node 85 produces the real output) ──
  workflow["16"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["4", 0],
      frame_rate: 16,
      loop_count: 0,
      filename_prefix: "GltchWAN-base",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      save_metadata: false,
      trim_to_audio: false,
      pingpong: false,
      save_output: false,
      ...(audioNodeId ? { audio: [audioNodeId, 0] } : {}),
    },
  };

  // ── Post-processing: RIFE 16fps → 32fps (GPU-accelerated) ──
  workflow["75"] = {
    class_type: "RIFEInterpolation",
    inputs: {
      images: ["4", 0],
      source_fps: 16,
      target_fps: 32,
      scale: 1.0,
      batch_size: 8,
      use_fp16: true,
    },
  };

  let finalFramesNode: [string, number] = ["75", 0];
  let finalFrameRate = 32;

  if (p.useUpscale) {
    workflow["78"] = {
      class_type: "RIFEInterpolation",
      inputs: {
        images: ["75", 0],
        source_fps: 32,
        target_fps: 64,
        scale: 1.0,
        batch_size: 4,
        use_fp16: true,
      },
    };
    finalFramesNode = ["78", 0];
    finalFrameRate = 64;
  }

  workflow["85"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: finalFramesNode,
      frame_rate: finalFrameRate,
      loop_count: 0,
      filename_prefix: "GltchWAN",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 15,
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
 * Z-Image Turbo txt2img workflow.
 * 6B param distilled model — 8 steps, CFG 1.0, sgm_uniform scheduler.
 * Uses split loaders: UNETLoader + CLIPLoader + VAELoader.
 */
export function buildZimageTurboWorkflow(p: {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  steps?: number;
  cfg?: number;
  lora?: string;
  loraStrength?: number;
}): Record<string, any> {
  const unet = process.env.COMFYUI_ZIMAGE_UNET || "z_image_turbo_bf16.safetensors";
  const clip = process.env.COMFYUI_ZIMAGE_CLIP || "qwen_3_4b.safetensors";
  const vae = process.env.COMFYUI_ZIMAGE_VAE || "ae.safetensors";

  const hasLora = !!p.lora && p.lora !== "none";
  let modelSource: [string, number] = ["1", 0];

  const workflow: Record<string, any> = {
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
  };

  if (hasLora) {
    workflow["10"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: p.lora!,
        strength_model: p.loraStrength ?? 1.0,
        strength_clip: p.loraStrength ?? 1.0,
        model: ["1", 0],
        clip: ["2", 0],
      },
    };
    modelSource = ["10", 0];
    workflow["4"].inputs.clip = ["10", 1];
    workflow["5"].inputs.clip = ["10", 1];
  }

  workflow["7"] = {
    class_type: "KSampler",
    inputs: {
      seed: p.seed,
      steps: p.steps || 8,
      cfg: p.cfg || 1.0,
      sampler_name: "euler_ancestral",
      scheduler: "sgm_uniform",
      denoise: 1,
      model: modelSource,
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["6", 0],
    },
  };

  workflow["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["7", 0], vae: ["3", 0] },
  };

  workflow["9"] = {
    class_type: "SaveImage",
    inputs: { filename_prefix: "GLTCH-ZImage", images: ["8", 0] },
  };

  return workflow;
}

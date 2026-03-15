/**
 * ComfyUI workflow builders for the Telegram bot.
 * Extracted from api/comfyui.ts — pure functions that produce JSON workflow objects.
 */

const WAN_DEFAULT_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走, twerking, dancing, gyrating, bouncing, jiggling, shaking hips, grinding, repetitive motion, exaggerated body movement, sexual movement, rhythmic swaying";

export { WAN_DEFAULT_NEGATIVE };

// ── Flux 2 Klein Image Edit ──

export function buildFlux2KleinEditWorkflow(p: {
  prompt: string;
  negativePrompt?: string;
  imageFilename: string;
  seed: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  megapixels?: number;
}): Record<string, any> {
  const unet = process.env.COMFYUI_KLEIN_UNET || "flux-2-klein-9b-nvfp4.safetensors";
  const clipModel = process.env.COMFYUI_KLEIN_CLIP || "qwen_3_8b_fp8mixed.safetensors";
  const vae = process.env.COMFYUI_KLEIN_VAE || "flux2-vae.safetensors";

  const defaultNeg = "ugly, deformed, noisy, blurry, low contrast, text, watermark, logo, bad anatomy, extra limbs, missing fingers, extra fingers, crop, low resolution, jpeg artifacts, cartoon, illustration, painting.";

  let modelSource: [string, number] = ["70", 0];
  let clipSource: [string, number] = ["71", 0];
  const rawClipSource: [string, number] = ["71", 0];

  const workflow: Record<string, any> = {
    "70": {
      class_type: "UNETLoader",
      inputs: { unet_name: unet, weight_dtype: "default" },
    },
    "71": {
      class_type: "CLIPLoader",
      inputs: { clip_name: clipModel, type: "flux2", device: "default" },
    },
    "72": {
      class_type: "VAELoader",
      inputs: { vae_name: vae },
    },
    "76": {
      class_type: "LoadImage",
      inputs: { image: p.imageFilename },
    },
  };

  workflow["83"] = {
    class_type: "LoraLoader",
    inputs: {
      lora_name: "KLEIN-Unchained-V2.safetensors",
      strength_model: 0.55,
      strength_clip: 0.45,
      model: modelSource,
      clip: clipSource,
    },
  };
  modelSource = ["83", 0];
  clipSource = ["83", 1];

  workflow["85"] = {
    class_type: "LoraLoader",
    inputs: {
      lora_name: "klein_slider_anatomy.safetensors",
      strength_model: 0.55,
      strength_clip: 0.45,
      model: modelSource,
      clip: clipSource,
    },
  };
  modelSource = ["85", 0];
  clipSource = ["85", 1];

  workflow["80"] = {
    class_type: "ImageScaleToTotalPixels",
    inputs: {
      upscale_method: "nearest-exact",
      megapixels: p.megapixels || 1,
      resolution_steps: 1,
      image: ["76", 0],
    },
  };

  workflow["81"] = {
    class_type: "GetImageSize",
    inputs: { image: ["80", 0] },
  };

  workflow["74"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: p.prompt, clip: clipSource },
  };

  workflow["67"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: p.negativePrompt || defaultNeg, clip: rawClipSource },
  };

  workflow["78"] = {
    class_type: "VAEEncode",
    inputs: { pixels: ["80", 0], vae: ["72", 0] },
  };

  workflow["77"] = {
    class_type: "ReferenceLatent",
    inputs: { conditioning: ["74", 0], latent: ["78", 0] },
  };

  workflow["79"] = {
    class_type: "ReferenceLatent",
    inputs: { conditioning: ["67", 0], latent: ["78", 0] },
  };

  workflow["66"] = {
    class_type: "EmptyFlux2LatentImage",
    inputs: { width: ["81", 0], height: ["81", 1], batch_size: 1 },
  };

  workflow["62"] = {
    class_type: "Flux2Scheduler",
    inputs: { steps: p.steps || 20, width: ["81", 0], height: ["81", 1] },
  };

  workflow["63"] = {
    class_type: "CFGGuider",
    inputs: {
      cfg: p.cfg || 5,
      model: modelSource,
      positive: ["77", 0],
      negative: ["79", 0],
    },
  };

  workflow["61"] = {
    class_type: "KSamplerSelect",
    inputs: { sampler_name: p.sampler || "euler_ancestral" },
  };

  workflow["73"] = {
    class_type: "RandomNoise",
    inputs: { noise_seed: p.seed },
  };

  workflow["64"] = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: ["73", 0],
      guider: ["63", 0],
      sampler: ["61", 0],
      sigmas: ["62", 0],
      latent_image: ["66", 0],
    },
  };

  workflow["65"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["64", 0], vae: ["72", 0] },
  };

  workflow["9"] = {
    class_type: "SaveImage",
    inputs: { images: ["65", 0], filename_prefix: "GrokRunner" },
  };

  return workflow;
}

// ── GLTCH WAN I2V Video ──

function addMMAudioNodes(
  workflow: Record<string, any>,
  framesNodeId: string,
  seed: number,
  audioPrompt: string,
): string {
  workflow["200"] = {
    class_type: "MMAudioModelLoader",
    inputs: {
      mmaudio_model: "mmaudio_large_44k_v2_fp16.safetensors",
      base_precision: "fp16",
    },
  };
  workflow["201"] = {
    class_type: "MMAudioFeatureUtilsLoader",
    inputs: {
      synchformer_model: "mmaudio_synchformer_fp16.safetensors",
      vae_model: "mmaudio_vae_44k_fp16.safetensors",
      clip_model: "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors",
      precision: "fp16",
    },
  };
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

export function buildGltchWanWorkflow(p: {
  prompt: string;
  negativePrompt?: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  frameCount: number;
  resolution: number;
  shift?: number;
  audioMode?: "none" | "ambient";
  audioPrompt?: string;
}): Record<string, any> {
  const splitStep = Math.max(1, Math.floor(p.steps / 2));
  const shift = p.shift ?? 8;
  const neg = p.negativePrompt || WAN_DEFAULT_NEGATIVE;

  const highModel = process.env.COMFYUI_GLTCH_HIGH_MODEL || "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8H.gguf";
  const lowModel = process.env.COMFYUI_GLTCH_LOW_MODEL || "wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8L.gguf";
  const isGguf = highModel.endsWith(".gguf") || lowModel.endsWith(".gguf");
  const clipModel = process.env.COMFYUI_WAN_CLIP || "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
  const clipVisionModel = process.env.COMFYUI_WAN_CLIP_VISION || "clip_vision_h.safetensors";

  const highModelSource: [string, number] = ["29", 0];
  const lowModelSource: [string, number] = ["30", 0];

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
      inputs: { clip: ["1", 0], text: neg },
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

  // ModelSamplingSD3 shift scheduling
  workflow["8"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: highModelSource, shift },
  };
  workflow["9"] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: lowModelSource, shift },
  };

  // Stage 1: High noise pass
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

  // VRAM cleanup between passes
  workflow["120"] = {
    class_type: "easy cleanGpuUsed",
    inputs: { anything: ["31", 0] },
  };

  // Stage 2: Low noise pass
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

  // VAE Decode
  workflow["4"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["2", 0], vae: ["7", 0] },
  };

  const audioMode = p.audioMode || "none";
  let audioNodeId: string | undefined;
  if (audioMode === "ambient") {
    audioNodeId = addMMAudioNodes(workflow, "4", p.seed, p.audioPrompt || p.prompt);
  }

  // Base 16fps output (fallback)
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
      save_output: true,
      ...(audioNodeId ? { audio: [audioNodeId, 0] } : {}),
    },
  };

  // Lanczos 2x upscale + RIFE 2x @ 32fps
  workflow["74"] = {
    class_type: "ImageScaleBy",
    inputs: { image: ["4", 0], upscale_method: "lanczos", scale_by: 2 },
  };
  workflow["76"] = {
    class_type: "easy cleanGpuUsed",
    inputs: { anything: ["74", 0] },
  };
  workflow["75"] = {
    class_type: "RIFE VFI",
    inputs: {
      frames: ["76", 0],
      ckpt_name: "rife49.pth",
      clear_cache_after_n_frames: 10,
      multiplier: 2,
      fast_mode: false,
      ensemble: true,
      scale_factor: 1,
      batch_size: 4,
      torch_compile: false,
      dtype: "auto",
    },
  };

  workflow["85"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["75", 0],
      frame_rate: 32,
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

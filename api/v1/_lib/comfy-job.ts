/**
 * Shared ComfyUI job plumbing for the public v1 API.
 *
 * Extracted from api/v1/comfy.ts when the async jobs endpoint was added, so the
 * two share one definition of every part that matters. The cost table is the
 * reason: this file already carried a comment warning that COMFY_COSTS had to
 * be kept in step with api/comfyui.ts, and it had previously drifted — the
 * models endpoint quoted double the real price for a while. A second consumer
 * copying the table by hand would have been the same bug again, waiting.
 *
 * Everything here is pure plumbing: cost and validity tables, the RunPod
 * endpoint map, the four workflow builders, and the output extraction and
 * upload path. No auth, no credit movement, no HTTP — those stay in the
 * handlers, which is what makes this safe for both the synchronous endpoint and
 * the asynchronous one to call.
 */

import { uploadPublicMedia } from "../../_lib/media-storage";
import {
  buildGltchWanWorkflow,
  buildGltchWanSimpleWorkflow,
  buildZimageTurboWorkflow,
} from "../../_lib/comfy-workflows";

export { buildGltchWanWorkflow, buildGltchWanSimpleWorkflow, buildZimageTurboWorkflow };

export function isVideoWorkflow(workflow: string): boolean {
  return workflow === "wan-video" || workflow === "gltch-wan";
}

/**
 * Which RunPod endpoint serves a workflow. Mirrors
 * getRunPodEndpointForWorkflow() in api/comfyui.ts: each family has its own
 * worker so their models do not compete for VRAM on one box.
 */
export function resolveEndpoint(workflow: string): string {
  const fallback = process.env.RUNPOD_ENDPOINT_ID || "";
  const qwen = process.env.RUNPOD_QWEN_EDIT_ENDPOINT_ID || fallback;
  if (workflow === "klein") return qwen;
  if (workflow === "wan-video" || workflow === "gltch-wan") {
    return process.env.RUNPOD_WAN_ENDPOINT_ID || fallback;
  }
  if (workflow === "zimage") return process.env.RUNPOD_ZIMAGE_ENDPOINT_ID || qwen;
  return fallback;
}

export const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

// Must track COMFY_COSTS in api/comfyui.ts — same work, same price either way in.
export const COMFY_COSTS: Record<string, number> = {
  "txt2img": 3,
  "zimage": 3,
  "klein": 3,
  "klein-hd": 4,
  "wan-video": 15,
  "gltch-wan": 15,
};

/**
 * Ordered by what people actually run. klein and gltch-wan are 97.6% of all
 * jobs; gltch-wan was missing from this list entirely while txt2img, which
 * nobody has used in 90 days, was the documented default.
 */
export const VALID_WORKFLOWS = ["klein", "gltch-wan", "zimage", "wan-video", "txt2img"];


// ── Workflow builders (match main comfyui.ts format) ──────────────────

export function buildTxt2ImgWorkflow(p: {
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
  const isFlux = p.checkpoint.toLowerCase().includes("flux");
  const hasLora = !!p.lora && p.lora !== "none";

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
    workflow["10"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: p.lora!,
        strength_model: p.loraStrength ?? 0.8,
        strength_clip: p.loraStrength ?? 0.8,
        model: ["4", 0],
        clip: ["4", 1],
      },
    };
  }

  return workflow;
}

export function buildKleinEditWorkflow(p: {
  prompt: string;
  negativePrompt?: string;
  imageFilename: string;
  seed: number;
  steps?: number;
  cfg?: number;
  loras?: { name: string; strengthModel: number; strengthClip: number }[];
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

  // Built-in LoRA: KLEIN-Unchained-V2
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

  // Built-in LoRA: klein_slider_anatomy
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

  // Chain any additional user LoRAs
  const activeLoras = (p.loras || []).filter(l => l.name && l.name !== "none");
  for (let i = 0; i < activeLoras.length; i++) {
    const nodeId = String(200 + i);
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

  // Scale input image
  workflow["80"] = {
    class_type: "ImageScaleToTotalPixels",
    inputs: {
      upscale_method: "nearest-exact",
      megapixels: 1,
      resolution_steps: 1,
      image: ["76", 0],
    },
  };

  workflow["81"] = {
    class_type: "GetImageSize",
    inputs: { image: ["80", 0] },
  };

  // Positive prompt (uses LoRA-enhanced CLIP)
  workflow["74"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: p.prompt, clip: clipSource },
  };

  // Negative prompt (uses raw CLIP — before LoRAs)
  workflow["67"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: p.negativePrompt || defaultNeg, clip: rawClipSource },
  };

  // VAE encode reference image
  workflow["78"] = {
    class_type: "VAEEncode",
    inputs: { pixels: ["80", 0], vae: ["72", 0] },
  };

  // ReferenceLatent conditioning
  workflow["77"] = {
    class_type: "ReferenceLatent",
    inputs: { conditioning: ["74", 0], latent: ["78", 0] },
  };
  workflow["79"] = {
    class_type: "ReferenceLatent",
    inputs: { conditioning: ["67", 0], latent: ["78", 0] },
  };

  // Empty Flux 2 latent
  workflow["66"] = {
    class_type: "EmptyFlux2LatentImage",
    inputs: { width: ["81", 0], height: ["81", 1], batch_size: 1 },
  };

  // Flux2 scheduler
  workflow["62"] = {
    class_type: "Flux2Scheduler",
    inputs: { steps: p.steps || 20, width: ["81", 0], height: ["81", 1] },
  };

  // CFG guider
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
    inputs: { sampler_name: "euler_ancestral" },
  };

  workflow["73"] = {
    class_type: "RandomNoise",
    inputs: { noise_seed: p.seed },
  };

  // SamplerCustomAdvanced
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

export const WAN_DEFAULT_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

export function buildWanVideoWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  frameCount: number;
}): Record<string, any> {
  const splitStep = Math.max(1, Math.floor(p.steps / 2));

  const highModel = process.env.COMFYUI_WAN_HIGH_MODEL
    || "Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v2.1.safetensors";
  const lowModel = process.env.COMFYUI_WAN_LOW_MODEL
    || "Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v2.1.safetensors";
  const clipModel = process.env.COMFYUI_WAN_CLIP
    || "umt5_xxl_fp8_e4m3fn_scaled.safetensors";

  let highModelSource: [string, number] = ["95", 0];
  let lowModelSource: [string, number] = ["96", 0];

  const workflow: Record<string, any> = {
    "84": { class_type: "CLIPLoader", inputs: { clip_name: clipModel, type: "wan", device: "cpu" } },
    "90": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
    "95": { class_type: "UNETLoader", inputs: { unet_name: highModel, weight_dtype: "fp8_e4m3fn" } },
    "96": { class_type: "UNETLoader", inputs: { unet_name: lowModel, weight_dtype: "fp8_e4m3fn" } },
    "97": { class_type: "LoadImage", inputs: { image: p.imageFilename } },
    "93": { class_type: "CLIPTextEncode", inputs: { clip: ["84", 0], text: p.prompt } },
    "89": { class_type: "CLIPTextEncode", inputs: { clip: ["84", 0], text: p.negativePrompt } },
  };

  workflow["104"] = { class_type: "ModelSamplingSD3", inputs: { model: highModelSource, shift: 12 } };
  workflow["103"] = { class_type: "ModelSamplingSD3", inputs: { model: lowModelSource, shift: 12 } };

  workflow["113"] = {
    class_type: "WanImageToVideo",
    inputs: {
      positive: ["93", 0], negative: ["89", 0], vae: ["90", 0],
      start_image: ["97", 0], width: p.width, height: p.height,
      length: p.frameCount, batch_size: 1,
    },
  };

  // Pass 1: high-noise
  workflow["86"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["104", 0], positive: ["113", 0], negative: ["113", 1],
      latent_image: ["113", 2], add_noise: "enable", noise_seed: p.seed,
      steps: p.steps, cfg: p.cfg, sampler_name: "uni_pc", scheduler: "beta",
      start_at_step: 0, end_at_step: splitStep, return_with_leftover_noise: "enable",
    },
  };

  workflow["120"] = { class_type: "easy cleanGpuUsed", inputs: { anything: ["86", 0] } };

  // Pass 2: low-noise
  workflow["85"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      model: ["103", 0], positive: ["113", 0], negative: ["113", 1],
      latent_image: ["120", 0], add_noise: "disable", noise_seed: p.seed,
      steps: p.steps, cfg: p.cfg, sampler_name: "uni_pc", scheduler: "beta",
      start_at_step: splitStep, end_at_step: 10000, return_with_leftover_noise: "disable",
    },
  };

  workflow["87"] = { class_type: "VAEDecode", inputs: { samples: ["85", 0], vae: ["90", 0] } };

  workflow["94"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["87", 0], frame_rate: 24, loop_count: 0,
      filename_prefix: "GrokRunner", format: "video/h264-mp4",
      pix_fmt: "yuv420p", crf: 19, save_metadata: true,
      trim_to_audio: false, pingpong: false, save_output: true,
    },
  };

  return workflow;
}

// Strip data URI prefix from base64 if present
export function cleanBase64(b64: string): string {
  const idx = b64.indexOf(",");
  return idx >= 0 ? b64.slice(idx + 1) : b64;
}

// ── Output extraction ─────────────────────────────────────────────────

/**
 * The worker hands back base64, not a link — a completed poll weighs 1-2MB.
 * The documented response promises `"image_url": "https://..."`, so anything
 * that isn't already a URL gets stored and turned into one. Without this the
 * field would carry a multi-megabyte base64 string under a name that says URL.
 *
 * Keyed under the owner's id: library-purge can only prove ownership of an
 * object from its key, and anything it can't attribute outlives deletion.
 */
export async function toPublicUrl(
  data: string,
  kind: "image" | "video",
  userId: string,
): Promise<string | null> {
  if (/^https?:\/\//i.test(data)) return data;
  try {
    const buffer = Buffer.from(cleanBase64(data), "base64");
    if (buffer.length < 1000) return null;
    const ext = kind === "video" ? "mp4" : "png";
    const mime = kind === "video" ? "video/mp4" : "image/png";
    const key = `v1-api/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { url } = await uploadPublicMedia(buffer, key, mime, { cacheSeconds: 604800 });
    return url || null;
  } catch (err: any) {
    console.error("[v1/comfy] upload failed:", err?.message);
    return null;
  }
}

export function extractFileData(file: any): string | null {
  if (typeof file === "string" && file.length > 50) return file;
  if (!file || typeof file !== "object") return null;
  return file.data || file.url || file.image_url || file.video_url || null;
}

export function extractComfyOutput(
  out: any,
  isVideo: boolean,
): { type: "video" | "image"; data: string } | null {
  if (!out || typeof out !== "object") return null;

  // Check flat top-level fields first
  const flatVideo = out.video_url || out.video || out.output;
  if (isVideo && typeof flatVideo === "string" && flatVideo.length > 50) {
    return { type: "video", data: flatVideo };
  }
  const flatImage = out.image_url || out.image || out.output;
  if (!isVideo && typeof flatImage === "string" && flatImage.length > 50) {
    return { type: "image", data: flatImage };
  }

  // Top-level arrays. The RunPod worker returns { images: [...] } — no node-id
  // wrapper at all — which the node scan below cannot see: it walks the keys of
  // `out` expecting each value to be a node object carrying `.images`, so for
  // key "images" it inspects the array itself and finds nothing. Every job that
  // COMPLETED on this worker was reported back as "no image returned".
  if (isVideo) {
    for (const arrKey of ["videos", "gifs"]) {
      const arr = out[arrKey];
      if (Array.isArray(arr) && arr.length) {
        const data = extractFileData(arr[arr.length - 1]);
        if (data) return { type: "video", data };
      }
    }
  }
  if (Array.isArray(out.images) && out.images.length) {
    const data = extractFileData(out.images[out.images.length - 1]);
    if (data) return { type: isVideo ? "video" : "image", data };
  }

  // Scan node outputs (ComfyUI returns { "94": { gifs: [...] }, "9": { images: [...] } })
  const keys = Object.keys(out).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return 0;
  });

  for (const key of keys) {
    const node = out[key];
    if (!node || typeof node !== "object") continue;

    // Video arrays: gifs, videos
    if (isVideo) {
      for (const arrKey of ["videos", "gifs"]) {
        const arr = node[arrKey];
        if (!Array.isArray(arr) || !arr.length) continue;
        const data = extractFileData(arr[arr.length - 1]);
        if (data) return { type: "video", data };
      }
    }

    // Image arrays: images
    const images = node.images;
    if (Array.isArray(images) && images.length) {
      const data = extractFileData(images[images.length - 1]);
      if (data) return { type: "image", data };
    }

    // Generic message field
    if (typeof node.message === "string" && node.message.length > 50) {
      return { type: isVideo ? "video" : "image", data: node.message };
    }
  }

  // Last resort: if top-level output is a long string (raw base64/URL)
  if (typeof out === "string" && out.length > 50) {
    return { type: isVideo ? "video" : "image", data: out };
  }

  return null;
}

// ── Handler ───────────────────────────────────────────────────────────

// ── Shared submit path ────────────────────────────────────────────────────
//
// Everything below is used by BOTH /api/v1/comfy (synchronous) and
// /api/v1/jobs (asynchronous). None of it moves credits or writes HTTP, so
// each handler keeps its own policy for those while the request handling
// itself stays identical between the two.

export const WORKFLOWS_NEEDING_IMAGE = ["klein", "wan-video", "gltch-wan"];

export function workflowNeedsImage(workflow: string): boolean {
  return WORKFLOWS_NEEDING_IMAGE.includes(workflow);
}

/**
 * Turn a validated request into the ComfyUI graph to run.
 *
 * The per-workflow clamps live here rather than in the handlers so the two
 * endpoints cannot disagree about what a legal width or frame count is.
 */
export function buildComfyGraph(o: {
  workflow: string;
  prompt: string;
  body: any;
  imageFilename: string;
  seed: number;
  steps: number;
  cfg: number;
}): Record<string, any> {
  const { workflow, prompt, body, imageFilename, seed, steps, cfg } = o;
  const clamp = (v: any, lo: number, hi: number, dflt: number) =>
    Math.min(hi, Math.max(lo, Number(v) || dflt));

  if (workflow === "klein") {
    const loras: { name: string; strengthModel: number; strengthClip: number }[] = [];
    if (body.lora && body.lora !== "none") {
      const str = clamp(body.lora_strength, 0, 2, 0.8);
      loras.push({ name: body.lora, strengthModel: str, strengthClip: str });
    }
    return buildKleinEditWorkflow({
      prompt,
      negativePrompt: body.negative_prompt || undefined,
      imageFilename, seed, steps, cfg, loras,
    });
  }

  if (workflow === "gltch-wan") {
    // The busiest video path in the app, and the whole reason the async
    // endpoint exists: it routinely outlives the synchronous 280s ceiling.
    const params = {
      prompt,
      negativePrompt: body.negative_prompt || WAN_DEFAULT_NEGATIVE,
      imageFilename,
      width: clamp(body.width, 256, 1024, 832),
      height: clamp(body.height, 256, 1024, 480),
      seed, steps, cfg,
      frameCount: clamp(body.frame_count, 17, 241, 81),
      resolution: clamp(body.resolution, 480, 1280, 832),
      shift: body.shift ? clamp(body.shift, 1, 15, 5) : undefined,
      audioMode: (body.audio_mode === "ambient" ? "ambient" : "none") as "none" | "ambient",
      audioPrompt: body.audio_prompt || undefined,
    };
    // Same switch the app honours, so both surfaces run the same graph.
    return process.env.COMFYUI_GLTCH_SIMPLE === "1"
      ? buildGltchWanSimpleWorkflow(params)
      : buildGltchWanWorkflow({ ...params, useUpscale: false });
  }

  if (workflow === "zimage") {
    return buildZimageTurboWorkflow({
      prompt,
      width: clamp(body.width, 256, 2048, 832),
      height: clamp(body.height, 256, 2048, 1216),
      seed, steps, cfg,
      lora: body.lora || undefined,
      loraStrength: Number(body.lora_strength) || 1.0,
    });
  }

  if (workflow === "wan-video") {
    return buildWanVideoWorkflow({
      prompt,
      negativePrompt: body.negative_prompt || WAN_DEFAULT_NEGATIVE,
      imageFilename,
      width: clamp(body.width, 256, 1024, 832),
      height: clamp(body.height, 256, 1024, 480),
      seed, steps, cfg,
      frameCount: clamp(body.frame_count, 17, 241, 81),
    });
  }

  return buildTxt2ImgWorkflow({
    prompt,
    negativePrompt: body.negative_prompt || "",
    width: clamp(body.width, 256, 2048, 832),
    height: clamp(body.height, 256, 2048, 1216),
    seed, steps, cfg,
    checkpoint: body.checkpoint,
    lora: body.lora || undefined,
    loraStrength: Number(body.lora_strength) || 0.8,
  });
}

/**
 * Download a caller-supplied source image.
 *
 * The guards matter because the URL comes from outside: HTTPS only, no
 * redirects, no private or link-local hosts, and a size cap. Without them this
 * is an SSRF primitive that fetches internal addresses on request — and this
 * host has several services bound to loopback.
 */
export async function fetchSourceImage(
  imageUrl: string,
): Promise<{ ok: true; base64: string } | { ok: false; message: string }> {
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "https:") {
      return { ok: false, message: "image_url must use HTTPS" };
    }
    if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc|fd|fe80|localhost)/i.test(parsed.hostname)) {
      return { ok: false, message: "image_url cannot point to private/internal addresses" };
    }
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!resp.ok) return { ok: false, message: `Failed to fetch image_url: HTTP ${resp.status}` };
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return { ok: false, message: `Failed to fetch image_url: not an image (${contentType})` };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) {
      return { ok: false, message: "Failed to fetch image_url: image too large (max 20MB)" };
    }
    return { ok: true, base64: cleanBase64(buf.toString("base64")) };
  } catch (err: any) {
    return { ok: false, message: `Failed to fetch image_url: ${err.message}` };
  }
}

/** Hand the graph to RunPod. Returns the job id to track, or why it refused. */
export async function submitToRunPod(
  endpoint: string,
  graph: Record<string, any>,
  imageBase64?: string,
  imageFilename?: string,
): Promise<{ ok: true; rpJobId: string } | { ok: false; message: string }> {
  const apiKey = process.env.RUNPOD_API_KEY || "";
  const payload: any = { input: { workflow: graph } };
  if (imageBase64 && imageFilename) {
    payload.input.images = [{ name: imageFilename, image: imageBase64 }];
  }
  try {
    const resp = await fetch(`${RUNPOD_API_BASE}/${endpoint}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("[v1/comfy-job] RunPod submit failed:", resp.status, text.slice(0, 300));
      // 402 is RunPod saying the account is out of money, which is worth
      // distinguishing from a bad graph when reading logs later.
      return { ok: false, message: resp.status === 402
        ? "Generation service is temporarily unfunded."
        : "Generation failed to start." };
    }
    const json: any = await resp.json();
    if (!json?.id) return { ok: false, message: "Generation service returned no job id." };
    return { ok: true, rpJobId: json.id };
  } catch (err: any) {
    console.error("[v1/comfy-job] RunPod submit threw:", err?.message);
    return { ok: false, message: "Generation service unreachable." };
  }
}

/** One status read. Returns null when the read itself failed, so callers retry. */
export async function pollRunPod(
  endpoint: string,
  rpJobId: string,
): Promise<{ status: string; output?: any; error?: string } | null> {
  const apiKey = process.env.RUNPOD_API_KEY || "";
  try {
    const resp = await fetch(`${RUNPOD_API_BASE}/${endpoint}/status/${rpJobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as any;
  } catch {
    return null;
  }
}

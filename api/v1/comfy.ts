/**
 * /api/v1/comfy — Public API for GLTCH PRO (ComfyUI) generation.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 *
 * Body:
 *   prompt: string (required)
 *   workflow: "txt2img" | "klein" | "wan-video" (default "klein")
 *   image_url?: string (required for klein)
 *   width?: number (256-2048, default 832)
 *   height?: number (256-2048, default 1216)
 *   steps?: number (1-100, default 20)
 *   cfg?: number (0.1-30, default 7)
 *   checkpoint?: string (required for txt2img)
 *   lora?: string (optional LoRA name)
 *   lora_strength?: number (0-2, default 0.8)
 *   negative_prompt?: string
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";
import { deductCredits, refundCredits, logUsage, getUserCredits } from "./_lib/credits";

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

const COMFY_COSTS: Record<string, number> = {
  "txt2img": 3,
  "klein": 3,
  "klein-hd": 4,
  "wan-video": 15,
};

const VALID_WORKFLOWS = ["txt2img", "klein", "wan-video"];

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
  maxDuration: 300,
};

// ── Workflow builders (match main comfyui.ts format) ──────────────────

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

function buildKleinEditWorkflow(p: {
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

const WAN_DEFAULT_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

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
function cleanBase64(b64: string): string {
  const idx = b64.indexOf(",");
  return idx >= 0 ? b64.slice(idx + 1) : b64;
}

// ── Output extraction ─────────────────────────────────────────────────

function extractFileData(file: any): string | null {
  if (typeof file === "string" && file.length > 50) return file;
  if (!file || typeof file !== "object") return null;
  return file.data || file.url || file.image_url || file.video_url || null;
}

function extractComfyOutput(
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const auth = await getUserFromApiKey(req);
    if (!auth) {
      return res.status(401).json({ error: "Invalid or missing API key." });
    }

    const { allowed } = await checkRateLimit(
      `apikey:${auth.apiKeyId}`, "v1-comfy",
      { max: auth.rateLimit, windowSeconds: 60 }
    );
    if (!allowed) return res.status(429).json({ error: "Rate limit exceeded." });

    const body = req.body || {};
    const prompt = (body.prompt as string || "").trim();
    if (!prompt || prompt.length > 5000) {
      return res.status(400).json({ error: "prompt is required (max 5000 chars)" });
    }

    const workflowType = (body.workflow as string || "klein").toLowerCase();
    if (!VALID_WORKFLOWS.includes(workflowType)) {
      return res.status(400).json({ error: `workflow must be one of: ${VALID_WORKFLOWS.join(", ")}` });
    }

    const sql = getDb();
    const ip = (req.headers["x-forwarded-for"] as string) || "unknown";

    const [user] = await sql`SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}`;
    if (!user) return res.status(404).json({ error: "User not found" });

    const available = getUserCredits(user);
    const totalCost = COMFY_COSTS[workflowType] ?? 3;

    if (available < totalCost) {
      return res.status(402).json({ error: "Insufficient credits", required: totalCost, available });
    }

    const rpApiKey = process.env.RUNPOD_API_KEY || "";

    // Resolve RunPod endpoint per workflow type
    const fallbackEndpoint = process.env.RUNPOD_ENDPOINT_ID || "";
    let rpEndpoint = fallbackEndpoint;
    if (workflowType === "klein") {
      rpEndpoint = process.env.RUNPOD_QWEN_EDIT_ENDPOINT_ID || fallbackEndpoint;
    } else if (workflowType === "wan-video") {
      rpEndpoint = process.env.RUNPOD_WAN_ENDPOINT_ID || fallbackEndpoint;
    }

    if (!rpEndpoint || !rpApiKey) {
      return res.status(503).json({ error: "GLTCH PRO service not configured" });
    }

    // Fetch image for edit/video workflows
    const needsImage = ["klein", "wan-video"].includes(workflowType);
    const imageUrl = (body.image_url as string || "").trim();
    if (needsImage && !imageUrl) {
      return res.status(400).json({ error: `image_url is required for ${workflowType} workflow` });
    }

    if (workflowType === "txt2img" && !body.checkpoint) {
      const modelsEnv = process.env.COMFYUI_MODELS || "";
      const checkpoints = modelsEnv.split(",").map(m => m.trim()).filter(Boolean);
      if (checkpoints.length === 0) {
        return res.status(400).json({ error: "checkpoint is required for txt2img" });
      }
      body.checkpoint = checkpoints[0];
    }

    const d = await deductCredits(sql, auth.userId, totalCost, user);

    const steps = Math.min(100, Math.max(1, Number(body.steps) || 20));
    const cfg = Math.min(30, Math.max(0.1, Number(body.cfg) || 7));
    const seed = Math.floor(Math.random() * 2 ** 32);
    const imageFilename = `api_input_${Date.now()}.jpg`;

    let imageBase64: string | undefined;
    if (needsImage) {
      try {
        const parsedImgUrl = new URL(imageUrl);
        if (parsedImgUrl.protocol !== "https:") {
          await refundCredits(sql, auth.userId, d);
          return res.status(400).json({ error: "image_url must use HTTPS" });
        }
        if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc|fd|fe80|localhost)/i.test(parsedImgUrl.hostname)) {
          await refundCredits(sql, auth.userId, d);
          return res.status(400).json({ error: "image_url cannot point to private/internal addresses" });
        }
        const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000), redirect: "error" });
        if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
        const contentType = imgResp.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) throw new Error(`Not an image (${contentType})`);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        if (buf.length > 20 * 1024 * 1024) throw new Error("Image too large (max 20MB)");
        imageBase64 = cleanBase64(buf.toString("base64"));
      } catch (err: any) {
        await refundCredits(sql, auth.userId, d);
        return res.status(400).json({ error: `Failed to fetch image_url: ${err.message}` });
      }
    }

    // Build the actual ComfyUI workflow JSON
    let comfyWorkflow: Record<string, any>;
    const isVideo = workflowType === "wan-video";

    if (workflowType === "klein") {
      const loras: { name: string; strengthModel: number; strengthClip: number }[] = [];
      if (body.lora && body.lora !== "none") {
        const str = Math.min(2, Math.max(0, Number(body.lora_strength) || 0.8));
        loras.push({ name: body.lora, strengthModel: str, strengthClip: str });
      }
      comfyWorkflow = buildKleinEditWorkflow({
        prompt,
        negativePrompt: body.negative_prompt || undefined,
        imageFilename,
        seed,
        steps,
        cfg,
        loras,
      });
    } else if (workflowType === "wan-video") {
      const width = Math.min(1024, Math.max(256, Number(body.width) || 832));
      const height = Math.min(1024, Math.max(256, Number(body.height) || 480));
      const frameCount = Math.min(241, Math.max(17, Number(body.frame_count) || 81));
      comfyWorkflow = buildWanVideoWorkflow({
        prompt,
        negativePrompt: body.negative_prompt || WAN_DEFAULT_NEGATIVE,
        imageFilename,
        width,
        height,
        seed,
        steps,
        cfg,
        frameCount,
      });
    } else {
      const width = Math.min(2048, Math.max(256, Number(body.width) || 832));
      const height = Math.min(2048, Math.max(256, Number(body.height) || 1216));
      comfyWorkflow = buildTxt2ImgWorkflow({
        prompt,
        negativePrompt: body.negative_prompt || "",
        width,
        height,
        seed,
        steps,
        cfg,
        checkpoint: body.checkpoint,
        lora: body.lora || undefined,
        loraStrength: Number(body.lora_strength) || 0.8,
      });
    }

    // Build RunPod payload in the same format as the main comfyui.ts
    const runpodPayload: any = { input: { workflow: comfyWorkflow } };
    if (imageBase64) {
      runpodPayload.input.images = [
        { name: imageFilename, image: imageBase64 },
      ];
    }

    const rpResp = await fetch(`${RUNPOD_API_BASE}/${rpEndpoint}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${rpApiKey}` },
      body: JSON.stringify(runpodPayload),
      signal: AbortSignal.timeout(30000),
    });

    if (!rpResp.ok) {
      await refundCredits(sql, auth.userId, d);
      const errText = await rpResp.text().catch(() => "");
      console.error("[v1/comfy] RunPod submit failed:", rpResp.status, errText.slice(0, 300));
      return res.status(502).json({ error: "Generation failed. Credits refunded." });
    }

    const submitResult: any = await rpResp.json();
    const jobId = submitResult.id;

    if (!jobId) {
      await refundCredits(sql, auth.userId, d);
      return res.status(502).json({ error: "No job ID returned. Credits refunded." });
    }

    // Poll for completion. Cap at ~280s so refund can run before 300s maxDuration.
    const deadline = Date.now() + 280_000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const pollResp = await fetch(`${RUNPOD_API_BASE}/${rpEndpoint}/status/${jobId}`, {
          headers: { Authorization: `Bearer ${rpApiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!pollResp.ok) continue;
        const pollData: any = await pollResp.json();

        if (pollData.status === "COMPLETED" && pollData.output) {
          const out = pollData.output;
          const result = extractComfyOutput(out, isVideo);

          if (!result) {
            await refundCredits(sql, auth.userId, d);
            const outputType = isVideo ? "video" : "image";
            return res.status(502).json({ error: `Generation completed but no ${outputType} returned. Credits refunded.` });
          }

          await logUsage(sql, auth, `comfy:${workflowType}`, totalCost, ip);

          if (result.type === "video") {
            return res.status(200).json({
              type: "comfy-video",
              workflow: workflowType,
              video_url: result.data,
              seed,
              credits_used: totalCost,
              credits_remaining: available - totalCost,
            });
          }
          return res.status(200).json({
            type: "comfy-image",
            workflow: workflowType,
            image_url: result.data,
            seed,
            credits_used: totalCost,
            credits_remaining: available - totalCost,
          });
        }

        if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(pollData.status)) {
          await refundCredits(sql, auth.userId, d);
          const detail = pollData.error || pollData.status;
          console.error("[v1/comfy] Generation failed:", detail);
          return res.status(502).json({ error: `Generation ${pollData.status.toLowerCase()}. Credits refunded.` });
        }
      } catch { continue; }
    }

    await refundCredits(sql, auth.userId, d);
    return res.status(504).json({ error: "Generation timed out. Credits refunded." });
  } catch (err: any) {
    console.error("[v1/comfy]", err.message, err.stack);
    const msg = err.message || "Internal error";
    if (msg.includes("Insufficient credits")) {
      return res.status(402).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
}

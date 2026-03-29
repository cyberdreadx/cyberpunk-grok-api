/**
 * /api/v1/comfy — Public API for GLTCH PRO (ComfyUI) generation.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 *
 * Body:
 *   prompt: string (required)
 *   workflow: "txt2img" | "klein" (default "klein")
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
};

const VALID_WORKFLOWS = ["txt2img", "klein"];

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

// Strip data URI prefix from base64 if present
function cleanBase64(b64: string): string {
  const idx = b64.indexOf(",");
  return idx >= 0 ? b64.slice(idx + 1) : b64;
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
    }

    if (!rpEndpoint || !rpApiKey) {
      return res.status(503).json({ error: "GLTCH PRO service not configured" });
    }

    // Fetch image for edit workflows
    const needsImage = workflowType === "klein";
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
        const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
        if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        imageBase64 = cleanBase64(buf.toString("base64"));
      } catch (err: any) {
        await refundCredits(sql, auth.userId, d);
        return res.status(400).json({ error: `Failed to fetch image_url: ${err.message}` });
      }
    }

    // Build the actual ComfyUI workflow JSON
    let comfyWorkflow: Record<string, any>;

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
          let image = out.image_url || out.output ||
            (typeof out === "string" ? out : null) ||
            (out.images?.length ? out.images[out.images.length - 1] : null);
          if (image && typeof image === "object") image = image.url || image.image_url || image.data;
          if (!image) {
            await refundCredits(sql, auth.userId, d);
            return res.status(502).json({ error: "Generation completed but no image URL returned. Credits refunded." });
          }
          await logUsage(sql, auth, `comfy:${workflowType}`, totalCost, ip);
          return res.status(200).json({
            type: "comfy-image",
            workflow: workflowType,
            image_url: image,
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

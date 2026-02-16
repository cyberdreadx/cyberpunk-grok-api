/**
 * /api/gltch — Public-facing GLTCH image edit endpoint.
 *
 * Uses the Qwen Edit model on RunPod Serverless (or local ComfyUI).
 * Available to any authenticated user with credits. NOT admin-only.
 *
 * POST { action: "submit" }  — submit an edit job, deduct credits, return jobId
 * POST { action: "poll" }    — check job status, return base64 image when done
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit, getClientIp } from "./_lib/ratelimit";

// ── Credit costs (must match client-side CREDIT_COSTS) ──

const GLTCH_COST = 0.5;
const GLTCH_HD_COST = 1;

// ── RunPod / Backend config ──

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

function getBackend() {
  const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
  const runpodKey = process.env.RUNPOD_API_KEY;
  if (runpodEndpoint && runpodKey) {
    return { mode: "runpod" as const, runpodEndpoint, runpodKey };
  }
  const comfyUrl = process.env.COMFYUI_URL?.replace(/\/+$/, "");
  if (comfyUrl) {
    return { mode: "local" as const, comfyUrl };
  }
  return { mode: "none" as const };
}

async function runpodRequest(
  endpoint: string, apiKey: string, path: string,
  method: "GET" | "POST" = "GET", body?: any,
) {
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${RUNPOD_API_BASE}/${endpoint}${path}`, opts);
}

async function uploadImageToLocal(baseUrl: string, imageBase64: string, rawName: string) {
  const base64Clean = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(base64Clean, "base64");
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const ct = isJpeg ? "image/jpeg" : "image/png";
  const fname = rawName || `gltch_${Date.now()}.jpg`;

  const boundary = `----GltchUpload${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: ${ct}\r\n\r\n`
  );
  const footer = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`
  );

  const resp = await fetch(`${baseUrl}/upload/image`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([header, buf, footer]),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Image upload failed (${resp.status})`);
  const result = await resp.json();
  return result.name as string;
}

// ── Aspect ratio → pixel dimensions (target ~1MP, multiples of 64) ──

function aspectToResolution(aspect: string): { width: number; height: number } {
  const map: Record<string, [number, number]> = {
    "1:1":  [1024, 1024],
    "16:9": [1344, 768],
    "9:16": [768, 1344],
    "4:3":  [1152, 896],
    "3:4":  [896, 1152],
    "3:2":  [1216, 832],
    "2:3":  [832, 1216],
    "2:1":  [1408, 704],
    "1:2":  [704, 1408],
  };
  const [width, height] = map[aspect] || [1024, 1024];
  return { width, height };
}

// ── Qwen Edit Workflow (simplified, server-controlled settings) ──

const QWEN_DEFAULT_NEGATIVE = "smooth skin, drawn, cgi, fake, cartoon, ugly, disfigured, sfx";

function buildQwenEditWorkflow(p: {
  prompt: string;
  negativePrompt: string;
  imageFilename: string;
  width: number;
  height: number;
  seed: number;
  checkpoint: string;
  upscale: boolean;
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
      inputs: { clip: ["125", 1], vae: ["125", 2], image1: ["123", 0], prompt: p.prompt },
    },
    "133": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: { clip: ["125", 1], vae: ["125", 2], prompt: p.negativePrompt },
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
        steps: 5,
        cfg: 1,
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
      inputs: { images: ["73", 0], filename_prefix: "GLTCH" },
    },
    ...(p.upscale ? {
      "128": {
        class_type: "UpscaleModelLoader",
        inputs: { model_name: "4x_foolhardy_Remacri.pth" },
      },
      "126": {
        class_type: "UltimateSDUpscale",
        inputs: {
          image: ["73", 0], model: ["125", 0],
          positive: ["132", 0], negative: ["133", 0], vae: ["125", 2],
          upscale_model: ["128", 0], upscale_by: 1.5, seed: p.seed,
          steps: 6, cfg: 1, sampler_name: "sa_solver", scheduler: "simple",
          denoise: 0.2, mode_type: "Linear",
          tile_width: 1024, tile_height: 1024, mask_blur: 8, tile_padding: 32,
          seam_fix_mode: "None", seam_fix_denoise: 1, seam_fix_width: 64,
          seam_fix_mask_blur: 8, seam_fix_padding: 16,
          force_uniform_tiles: true, tiled_decode: false,
        },
      },
      "200": {
        class_type: "SaveImage",
        inputs: { images: ["126", 0], filename_prefix: "GLTCH_HD" },
      },
    } : {}),
  };
}

// ── Friendly error messages ──

function friendlyError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "Generation timed out. The server may be busy — please try again.";
  if (lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("not responding"))
    return "GPU server is temporarily unavailable. Please try again in a moment.";
  if (lower.includes("insufficient") || lower.includes("credits"))
    return "Not enough credits for this edit.";
  if (lower.includes("rate limit"))
    return "Too many requests. Please wait a moment before trying again.";
  return "Edit failed. Please try again.";
}

// =============== Handler ===============

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Auth: any logged-in user (not admin-only)
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Sign in to use GLTCH edit." });

  const backend = getBackend();
  if (backend.mode === "none") {
    return res.status(503).json({ error: "GLTCH service is not configured." });
  }

  const { action } = req.body || {};

  try {
    // ========== SUBMIT ==========
    if (action === "submit") {
      const { prompt, imageBase64, aspectRatio = "1:1", hd = false } = req.body;

      if (!prompt || typeof prompt !== "string" || !prompt.trim())
        return res.status(400).json({ error: "Prompt is required." });
      if (prompt.length > 5000)
        return res.status(400).json({ error: "Prompt too long (max 5,000 characters)." });
      if (!imageBase64)
        return res.status(400).json({ error: "An image is required for editing." });

      // Rate limit: 20 GLTCH requests per user per 5 minutes
      const { allowed } = await checkRateLimit(auth.userId, "gltch", { max: 20, windowSeconds: 300 });
      if (!allowed) {
        return res.status(429).json({ error: "Too many GLTCH requests. Please wait a moment." });
      }

      // Credit check + deduction
      const cost = hd ? GLTCH_HD_COST : GLTCH_COST;
      const sql = getDb();

      const rows = await sql`SELECT sub_credits, pack_credits FROM users WHERE id = ${auth.userId}`;
      if (rows.length === 0) return res.status(404).json({ error: "User not found." });

      const total = (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
      if (total < cost) {
        return res.status(402).json({ error: `Not enough credits. This edit costs ${cost} credit${cost !== 1 ? "s" : ""}.` });
      }

      // Deduct credits BEFORE submitting the job
      try {
        await sql`SELECT deduct_credits(${auth.userId}::uuid, ${cost})`;
      } catch (err: any) {
        return res.status(402).json({ error: "Failed to deduct credits." });
      }

      // Refund helper for non-moderation failures
      const refundCredits = async () => {
        try { await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`; }
        catch { /* best effort */ }
      };

      // Build workflow
      const checkpoint = process.env.GLTCH_CHECKPOINT
        || (process.env.COMFYUI_MODELS || "").split(",")[0]?.trim()
        || "model.safetensors";

      const seed = Math.floor(Math.random() * 2 ** 32);
      const { width, height } = aspectToResolution(aspectRatio);
      const imageFilename = `gltch_${auth.userId.slice(0, 8)}_${Date.now()}.jpg`;

      let uploadedFilename = imageFilename;

      // For local ComfyUI, upload image first
      if (backend.mode === "local") {
        try {
          uploadedFilename = await uploadImageToLocal(backend.comfyUrl!, imageBase64, imageFilename);
        } catch (err: any) {
          await refundCredits();
          return res.status(500).json({ error: "Failed to upload image." });
        }
      }

      const workflow = buildQwenEditWorkflow({
        prompt: prompt.trim(),
        negativePrompt: QWEN_DEFAULT_NEGATIVE,
        imageFilename: backend.mode === "runpod" ? imageFilename : uploadedFilename,
        width, height, seed, checkpoint,
        upscale: !!hd,
      });

      // Submit to backend
      if (backend.mode === "runpod") {
        const runpodInput: any = {
          workflow,
          images: [{ name: imageFilename, image: imageBase64 }],
        };

        const resp = await runpodRequest(
          backend.runpodEndpoint!, backend.runpodKey!, "/run", "POST",
          { input: runpodInput },
        );

        if (!resp.ok) {
          await refundCredits();
          const errText = await resp.text().catch(() => "Unknown error");
          console.error("[gltch] RunPod submit failed:", errText.slice(0, 500));
          return res.status(502).json({ error: friendlyError(errText) });
        }

        const result = await resp.json();

        // Log usage
        await sql`
          INSERT INTO usage_log (user_id, mode, credits_used, prompt)
          VALUES (${auth.userId}::uuid, ${hd ? "gltch-edit-hd" : "gltch-edit"}, ${cost}, ${prompt.trim().slice(0, 500)})
        `.catch(() => {});

        return res.status(200).json({ promptId: result.id, seed });
      } else {
        // Local ComfyUI
        const resp = await fetch(`${backend.comfyUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow }),
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          await refundCredits();
          const errText = await resp.text().catch(() => "Unknown error");
          console.error("[gltch] ComfyUI submit failed:", errText.slice(0, 500));
          return res.status(502).json({ error: friendlyError(errText) });
        }

        const result = await resp.json();

        await sql`
          INSERT INTO usage_log (user_id, mode, credits_used, prompt)
          VALUES (${auth.userId}::uuid, ${hd ? "gltch-edit-hd" : "gltch-edit"}, ${cost}, ${prompt.trim().slice(0, 500)})
        `.catch(() => {});

        return res.status(200).json({ promptId: result.prompt_id, seed });
      }
    }

    // ========== POLL ==========
    if (action === "poll") {
      const { promptId } = req.body;
      if (!promptId) return res.status(400).json({ error: "promptId is required." });

      if (backend.mode === "runpod") {
        const resp = await runpodRequest(backend.runpodEndpoint!, backend.runpodKey!, `/status/${promptId}`);
        if (!resp.ok) throw new Error(`Status check failed (${resp.status})`);

        const data = await resp.json();

        if (data.status === "COMPLETED") {
          const images = data.output?.images;
          if (images?.length) {
            const img = images[images.length - 1];
            const base64Data = img.data;
            const imageUri = base64Data.startsWith("data:") ? base64Data : `data:image/png;base64,${base64Data}`;
            return res.status(200).json({ status: "done", image: imageUri });
          }
          if (data.output?.message) {
            const msg = data.output.message;
            return res.status(200).json({ status: "done", image: msg.startsWith("data:") ? msg : `data:image/png;base64,${msg}` });
          }
          return res.status(200).json({ status: "error", error: "Job completed but no output found." });
        }

        if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(data.status)) {
          return res.status(200).json({ status: "error", error: friendlyError(data.error || `Job ${data.status.toLowerCase()}.`) });
        }

        return res.status(200).json({ status: "pending" });
      } else {
        // Local ComfyUI polling
        const resp = await fetch(`${backend.comfyUrl}/history/${promptId}`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) throw new Error(`History check failed (${resp.status})`);

        const history = await resp.json();
        const entry = history[promptId];
        if (!entry) return res.status(200).json({ status: "pending" });

        if (entry.status?.status_str === "error") {
          return res.status(200).json({ status: "error", error: "Edit failed. Please try again." });
        }

        const outputs = entry.outputs || {};
        for (const nodeId of Object.keys(outputs)) {
          const images = outputs[nodeId]?.images;
          if (images?.length) {
            const img = images[images.length - 1];
            const params = new URLSearchParams({
              filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output",
            });
            const imgResp = await fetch(`${backend.comfyUrl}/view?${params}`, { signal: AbortSignal.timeout(10000) });
            if (!imgResp.ok) throw new Error(`Failed to fetch image (${imgResp.status})`);

            const buffer = await imgResp.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            const ct = imgResp.headers.get("content-type") || "image/png";
            return res.status(200).json({ status: "done", image: `data:${ct};base64,${base64}` });
          }
        }

        return res.status(200).json({ status: "pending" });
      }
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error("[gltch]", err.message);
    return res.status(500).json({ error: friendlyError(err.message || "Request failed") });
  }
}

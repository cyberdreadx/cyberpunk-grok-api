/**
 * /api/v1/comfy — Public API for GLTCH PRO (ComfyUI) generation.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 *
 * Body:
 *   prompt: string (required)
 *   workflow: "txt2img" | "klein" | "wan-video" | "gltch-wan" (default "txt2img")
 *   image_url?: string (required for klein, wan-video, gltch-wan)
 *   width?: number (256-2048, default 832)
 *   height?: number (256-2048, default 1216)
 *   steps?: number (1-100, default 20)
 *   cfg?: number (0.1-30, default 7)
 *   checkpoint?: string (required for txt2img)
 *   lora?: string (optional LoRA name)
 *   lora_strength?: number (0-2, default 0.8)
 *   negative_prompt?: string
 *   upscale?: boolean (HD upscale for edits)
 *   frame_count?: number (17-241, for video workflows)
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
  "gltch-wan": 15,
  "gltch-wan-hd": 18,
};

const VALID_WORKFLOWS = ["txt2img", "klein", "wan-video", "gltch-wan"];

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
  maxDuration: 300,
};

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

    const workflow = (body.workflow as string || "txt2img").toLowerCase();
    if (!VALID_WORKFLOWS.includes(workflow)) {
      return res.status(400).json({ error: `workflow must be one of: ${VALID_WORKFLOWS.join(", ")}` });
    }

    const sql = getDb();
    const ip = (req.headers["x-forwarded-for"] as string) || "unknown";

    const [user] = await sql`SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}`;
    if (!user) return res.status(404).json({ error: "User not found" });

    const available = getUserCredits(user);
    const upscale = body.upscale === true;
    const costKey = workflow === "klein" && upscale ? "klein-hd"
      : workflow === "gltch-wan" && upscale ? "gltch-wan-hd"
      : workflow;
    const totalCost = COMFY_COSTS[costKey] ?? 3;

    if (available < totalCost) {
      return res.status(402).json({ error: "Insufficient credits", required: totalCost, available });
    }

    // Get backend config
    const endpointId = process.env.RUNPOD_ENDPOINT_ID || "";
    const apiKey = process.env.RUNPOD_API_KEY || "";
    if (!endpointId || !apiKey) {
      return res.status(503).json({ error: "GLTCH PRO service not configured" });
    }

    // For workflows needing images, the API takes a URL and we pass it through
    const needsImage = ["klein", "wan-video", "gltch-wan"].includes(workflow);
    const imageUrl = (body.image_url as string || "").trim();
    if (needsImage && !imageUrl) {
      return res.status(400).json({ error: `image_url is required for ${workflow} workflow` });
    }

    if (workflow === "txt2img" && !body.checkpoint) {
      // Use first available checkpoint from env
      const modelsEnv = process.env.COMFYUI_MODELS || "";
      const checkpoints = modelsEnv.split(",").map(m => m.trim()).filter(Boolean);
      if (checkpoints.length === 0) {
        return res.status(400).json({ error: "checkpoint is required for txt2img" });
      }
      body.checkpoint = checkpoints[0];
    }

    const d = await deductCredits(sql, auth.userId, totalCost, user);

    const width = Math.min(2048, Math.max(256, Number(body.width) || 832));
    const height = Math.min(2048, Math.max(256, Number(body.height) || 1216));
    const steps = Math.min(100, Math.max(1, Number(body.steps) || 20));
    const cfg = Math.min(30, Math.max(0.1, Number(body.cfg) || 7));
    const loraStrength = Math.min(2, Math.max(0, Number(body.lora_strength) || 0.8));
    const frameCount = Math.min(241, Math.max(17, Number(body.frame_count) || 81));
    const seed = Math.floor(Math.random() * 2 ** 32);

    let imageBase64: string | undefined;
    if (needsImage) {
      try {
        const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
        if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        imageBase64 = buf.toString("base64");
      } catch (err: any) {
        await refundCredits(sql, auth.userId, d);
        return res.status(400).json({ error: `Failed to fetch image_url: ${err.message}` });
      }
    }

    const runpodInput: any = {
      input: {
        workflow,
        prompt,
        negative_prompt: body.negative_prompt || "",
        width,
        height,
        steps,
        cfg,
        seed,
      },
    };

    if (body.checkpoint) runpodInput.input.checkpoint = body.checkpoint;
    if (body.lora) {
      runpodInput.input.lora = body.lora;
      runpodInput.input.lora_strength = loraStrength;
    }
    if (imageBase64) {
      runpodInput.input.image = imageBase64;
      runpodInput.input.image_filename = `api_input_${Date.now()}.jpg`;
    }
    if (upscale) runpodInput.input.upscale = true;
    if (body.frame_count) runpodInput.input.frame_count = frameCount;

    // Determine endpoint (video workflows may use different endpoint)
    let rpEndpoint = endpointId;
    if (["wan-video", "gltch-wan"].includes(workflow)) {
      rpEndpoint = process.env.RUNPOD_VIDEO_ENDPOINT_ID || endpointId;
    }

    const rpResp = await fetch(`${RUNPOD_API_BASE}/${rpEndpoint}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(runpodInput),
      signal: AbortSignal.timeout(30000),
    });

    if (!rpResp.ok) {
      await refundCredits(sql, auth.userId, d);
      const errText = await rpResp.text().catch(() => "");
      console.error("[v1/comfy] RunPod submit failed:", rpResp.status, errText.slice(0, 300));
      return res.status(502).json({ error: "Generation failed. Credits refunded.", upstream_status: rpResp.status, detail: errText.slice(0, 500) });
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
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!pollResp.ok) continue;
        const pollData: any = await pollResp.json();

        if (pollData.status === "COMPLETED" && pollData.output) {
          const out = pollData.output;
          const isVideo = workflow.includes("video") || workflow.includes("wan");

          if (isVideo) {
            const videoUrl = out.video_url || out.video || out.output ||
              (typeof out === "string" ? out : null);
            if (!videoUrl) {
              await refundCredits(sql, auth.userId, d);
              return res.status(502).json({ error: "Generation completed but no video URL returned. Credits refunded." });
            }
            await logUsage(sql, auth, `comfy:${workflow}`, totalCost, ip);
            return res.status(200).json({
              type: "comfy-video",
              workflow,
              video_url: videoUrl,
              credits_used: totalCost,
              credits_remaining: available - totalCost,
            });
          } else {
            let image = out.image_url || out.output ||
              (typeof out === "string" ? out : null) ||
              (out.images?.length ? out.images[out.images.length - 1] : null);
            if (image && typeof image === "object") image = image.url || image.image_url || image.data;
            if (!image) {
              await refundCredits(sql, auth.userId, d);
              return res.status(502).json({ error: "Generation completed but no image URL returned. Credits refunded." });
            }
            await logUsage(sql, auth, `comfy:${workflow}`, totalCost, ip);
            return res.status(200).json({
              type: "comfy-image",
              workflow,
              image_url: image,
              credits_used: totalCost,
              credits_remaining: available - totalCost,
            });
          }
        }

        if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(pollData.status)) {
          await refundCredits(sql, auth.userId, d);
          return res.status(502).json({ error: `Generation ${pollData.status.toLowerCase()}. Credits refunded.`, detail: JSON.stringify(pollData).slice(0, 500) });
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

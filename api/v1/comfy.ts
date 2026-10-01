/**
 * /api/v1/comfy — Public API for GLTCH PRO (ComfyUI) generation.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 *
 * Body:
 *   prompt: string (required)
 *   workflow: "klein" | "gltch-wan" | "zimage" | "wan-video" | "txt2img"
 *             (default "klein")
 *   image_url?: string (required for klein, gltch-wan, wan-video)
 *   width?: number (256-2048, default 832)
 *   height?: number (256-2048, default 1216; video defaults 832x480, caps 1024)
 *   steps?: number (1-100, default 20)
 *   cfg?: number (0.1-30, default 7)
 *   checkpoint?: string (required for txt2img)
 *   lora?: string (optional LoRA name)
 *   lora_strength?: number (0-2, default 0.8)
 *   negative_prompt?: string
 *   frame_count?: number (17-241, default 81; video only)
 *   resolution?: number (480-1280, default 832; gltch-wan only)
 *   shift?: number (1-15; gltch-wan only)
 *   audio_mode?: "none" | "ambient"  (gltch-wan only)
 *   audio_prompt?: string (gltch-wan only)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";
import { deductCredits, refundCredits, logUsage, getUserCredits, discountedCostForUser } from "./_lib/credits";
import { isEmailVerified, EMAIL_VERIFICATION_REQUIRED_MESSAGE, EMAIL_VERIFICATION_REQUIRED_CODE } from "../_lib/emailVerifiedGate";

/*
 * The cost table, workflow builders and output handling used to live here.
 * They moved to ./_lib/comfy-job when /api/v1/jobs was added, so the
 * synchronous and asynchronous endpoints cannot drift apart.
 */
import {
  COMFY_COSTS,
  RUNPOD_API_BASE,
  VALID_WORKFLOWS,
  WAN_DEFAULT_NEGATIVE,
  buildKleinEditWorkflow,
  buildTxt2ImgWorkflow,
  buildWanVideoWorkflow,
  cleanBase64,
  extractComfyOutput,
  extractFileData,
  toPublicUrl,
  isVideoWorkflow,
  resolveEndpoint,
  buildGltchWanWorkflow,
  buildGltchWanSimpleWorkflow,
  buildZimageTurboWorkflow,
} from "./_lib/comfy-job";

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

    // Same gate as the session paths: an API key issued to an unverified
    // account is the identical hole with an extra step. This check used to sit
    // INSIDE the !auth block above, after its return — so it never ran.
    if (!(await isEmailVerified(auth.userId))) {
      return res.status(403).json({
        error: EMAIL_VERIFICATION_REQUIRED_MESSAGE,
        code: EMAIL_VERIFICATION_REQUIRED_CODE,
      });
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

    const [user] = await sql`SELECT daily_credits, sub_credits, pack_credits, COALESCE(subscription_discount_pct, 0) AS subscription_discount_pct FROM users WHERE id = ${auth.userId}`;
    if (!user) return res.status(404).json({ error: "User not found" });

    const available = getUserCredits(user);
    const totalCost = await discountedCostForUser(auth.userId, COMFY_COSTS[workflowType] ?? 3);

    if (available < totalCost) {
      return res.status(402).json({ error: "Insufficient credits", required: totalCost, available });
    }

    const rpApiKey = process.env.RUNPOD_API_KEY || "";

    // Resolve RunPod endpoint per workflow type
    // Mirrors getRunPodEndpointForWorkflow() in api/comfyui.ts: each family has
    // its own worker so their models don't compete for VRAM on one box.
    const fallbackEndpoint = process.env.RUNPOD_ENDPOINT_ID || "";
    const qwenEndpoint = process.env.RUNPOD_QWEN_EDIT_ENDPOINT_ID || fallbackEndpoint;
    let rpEndpoint = fallbackEndpoint;
    if (workflowType === "klein") {
      rpEndpoint = qwenEndpoint;
    } else if (workflowType === "wan-video" || workflowType === "gltch-wan") {
      rpEndpoint = process.env.RUNPOD_WAN_ENDPOINT_ID || fallbackEndpoint;
    } else if (workflowType === "zimage") {
      rpEndpoint = process.env.RUNPOD_ZIMAGE_ENDPOINT_ID || qwenEndpoint;
    }

    if (!rpEndpoint || !rpApiKey) {
      return res.status(503).json({ error: "GLTCH PRO service not configured" });
    }

    // Fetch image for edit/video workflows
    const needsImage = ["klein", "wan-video", "gltch-wan"].includes(workflowType);
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
    const isVideo = workflowType === "wan-video" || workflowType === "gltch-wan";

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
    } else if (workflowType === "gltch-wan") {
      // The busiest video path in the app (3,784 jobs last month) and the one
      // this endpoint had no way to reach. Same graph the app runs.
      const width = Math.min(1024, Math.max(256, Number(body.width) || 832));
      const height = Math.min(1024, Math.max(256, Number(body.height) || 480));
      const frameCount = Math.min(241, Math.max(17, Number(body.frame_count) || 81));
      const resolution = Math.min(1280, Math.max(480, Number(body.resolution) || 832));
      const params = {
        prompt,
        negativePrompt: body.negative_prompt || WAN_DEFAULT_NEGATIVE,
        imageFilename,
        width,
        height,
        seed,
        steps,
        cfg,
        frameCount,
        resolution,
        shift: body.shift ? Math.min(15, Math.max(1, Number(body.shift))) : undefined,
        audioMode: (body.audio_mode === "ambient" ? "ambient" : "none") as "none" | "ambient",
        audioPrompt: body.audio_prompt || undefined,
      };
      // Same switch the app honours, so both surfaces run the same graph.
      comfyWorkflow = process.env.COMFYUI_GLTCH_SIMPLE === "1"
        ? buildGltchWanSimpleWorkflow(params)
        : buildGltchWanWorkflow({ ...params, useUpscale: false });
    } else if (workflowType === "zimage") {
      const width = Math.min(2048, Math.max(256, Number(body.width) || 832));
      const height = Math.min(2048, Math.max(256, Number(body.height) || 1216));
      comfyWorkflow = buildZimageTurboWorkflow({
        prompt,
        width,
        height,
        seed,
        steps,
        cfg,
        lora: body.lora || undefined,
        loraStrength: Number(body.lora_strength) || 1.0,
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

          const publicUrl = await toPublicUrl(result.data, result.type, auth.userId);
          if (!publicUrl) {
            await refundCredits(sql, auth.userId, d);
            return res.status(502).json({ error: `Generation succeeded but the ${result.type} could not be stored. Credits refunded.` });
          }

          await logUsage(sql, auth, `comfy:${workflowType}`, totalCost, ip);

          if (result.type === "video") {
            return res.status(200).json({
              type: "comfy-video",
              workflow: workflowType,
              video_url: publicUrl,
              seed,
              credits_used: totalCost,
              credits_remaining: available - totalCost,
            });
          }
          return res.status(200).json({
            type: "comfy-image",
            workflow: workflowType,
            image_url: publicUrl,
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

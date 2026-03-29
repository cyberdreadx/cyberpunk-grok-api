/**
 * /api/v1/generate — Public API for image & video generation.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 * Deducts credits from the key owner's account.
 *
 * Image body:
 *   prompt: string (required)
 *   type?: "image" (default)
 *   model?: "grok-2-image" | "grok-2-image-pro"
 *   n?: 1-4
 *   response_format?: "url" | "b64_json"
 *
 * Video body:
 *   prompt: string (required)
 *   type: "video"
 *   duration?: 5 | 10  (seconds, default 5)
 *   image_url?: string  (image-to-video)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";

const XAI_BASE = "https://api.x.ai/v1";

const IMAGE_MODELS = ["grok-2-image", "grok-2-image-pro"] as const;
const CREDITS_PER_VIDEO_SECOND = 3;

const IMAGE_CREDIT_COSTS: Record<string, number> = {
  "grok-2-image": 2,
  "grok-2-image-pro": 5,
};

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
  maxDuration: 300,
};

/** Deduct credits from user, returning the breakdown for potential refund. */
async function deductCredits(sql: any, userId: string, totalCost: number, user: any) {
  let remaining = totalCost;
  const dDaily = Math.min(remaining, user.daily_credits || 0); remaining -= dDaily;
  const dSub = Math.min(remaining, user.sub_credits || 0); remaining -= dSub;
  const dPack = remaining;

  await sql`
    UPDATE users SET
      daily_credits = daily_credits - ${dDaily},
      sub_credits = sub_credits - ${dSub},
      pack_credits = pack_credits - ${dPack}
    WHERE id = ${userId}
  `;
  return { dDaily, dSub, dPack };
}

async function refundCredits(sql: any, userId: string, d: { dDaily: number; dSub: number; dPack: number }) {
  await sql`
    UPDATE users SET
      daily_credits = daily_credits + ${d.dDaily},
      sub_credits = sub_credits + ${d.dSub},
      pack_credits = pack_credits + ${d.dPack}
    WHERE id = ${userId}
  `;
}

async function logUsage(sql: any, auth: any, action: string, totalCost: number, ip: string) {
  await sql`
    INSERT INTO api_usage_log (api_key_id, user_id, action, credits_used, ip_address)
    VALUES (${auth.apiKeyId}, ${auth.userId}, ${action}, ${totalCost}, ${ip})
  `;
  await sql`
    UPDATE api_keys SET total_credits = total_credits + ${totalCost} WHERE id = ${auth.apiKeyId}
  `;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    // ── Auth ──
    const auth = await getUserFromApiKey(req);
    if (!auth) {
      return res.status(401).json({
        error: "Invalid or missing API key. Pass X-API-Key header with your gltch_sk_* key.",
      });
    }

    const { allowed } = await checkRateLimit(
      `apikey:${auth.apiKeyId}`, "v1-generate",
      { max: auth.rateLimit, windowSeconds: 60 }
    );
    if (!allowed) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });

    // ── Parse body ──
    const body = req.body || {};
    const prompt = (body.prompt as string || "").trim();
    if (!prompt || prompt.length > 5000) {
      return res.status(400).json({ error: "prompt is required (max 5000 chars)" });
    }

    const type = (body.type as string || "image").toLowerCase();
    const sql = getDb();
    const XAI_API_KEY = process.env.XAI_API_KEY;

    // Fetch user credits
    const [user] = await sql`
      SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });
    const available = (user.daily_credits || 0) + (user.sub_credits || 0) + (user.pack_credits || 0);
    const ip = (req.headers["x-forwarded-for"] as string) || "unknown";

    // ═══════════════════════════════════════════════════════════════════
    // IMAGE GENERATION
    // ═══════════════════════════════════════════════════════════════════
    if (type === "image") {
      const model = (body.model as string) || "grok-2-image";
      if (!IMAGE_MODELS.includes(model as any)) {
        return res.status(400).json({ error: `model must be one of: ${IMAGE_MODELS.join(", ")}` });
      }

      const n = Math.min(Math.max(parseInt(body.n) || 1, 1), 4);
      const responseFormat = body.response_format === "b64_json" ? "b64_json" : "url";
      const totalCost = (IMAGE_CREDIT_COSTS[model] || 2) * n;

      if (available < totalCost) {
        return res.status(402).json({ error: "Insufficient credits", required: totalCost, available, topUp: "https://grokrunner.gltch.app" });
      }

      if (!XAI_API_KEY) return res.status(500).json({ error: "Generation service not configured" });

      const d = await deductCredits(sql, auth.userId, totalCost, user);

      const xaiRes = await fetch(`${XAI_BASE}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${XAI_API_KEY}` },
        body: JSON.stringify({ prompt, model, n, response_format: responseFormat }),
      });

      if (!xaiRes.ok) {
        await refundCredits(sql, auth.userId, d);
        const errText = await xaiRes.text().catch(() => "");
        console.error("[v1/generate] xAI image error:", xaiRes.status, errText);
        if (xaiRes.status === 400 && errText.includes("safety")) {
          return res.status(400).json({ error: "Content policy violation" });
        }
        return res.status(502).json({ error: "Generation failed. Credits refunded." });
      }

      const result = await xaiRes.json();
      await logUsage(sql, auth, `image:${model}`, totalCost, ip);
      return res.status(200).json({ ...result, type: "image", credits_used: totalCost, credits_remaining: available - totalCost });
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIDEO GENERATION
    // ═══════════════════════════════════════════════════════════════════
    if (type === "video") {
      const duration = body.duration === 10 ? 10 : 5;
      const totalCost = CREDITS_PER_VIDEO_SECOND * duration;
      const imageUrl = (body.image_url as string || "").trim();

      if (available < totalCost) {
        return res.status(402).json({ error: "Insufficient credits", required: totalCost, available, topUp: "https://grokrunner.gltch.app" });
      }

      if (!XAI_API_KEY) return res.status(500).json({ error: "Generation service not configured" });

      const d = await deductCredits(sql, auth.userId, totalCost, user);

      // Build xAI request
      const videoBody: any = { prompt, duration };
      if (imageUrl) videoBody.image_url = imageUrl;

      const xaiRes = await fetch(`${XAI_BASE}/videos/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${XAI_API_KEY}` },
        body: JSON.stringify(videoBody),
      });

      if (!xaiRes.ok) {
        await refundCredits(sql, auth.userId, d);
        const errText = await xaiRes.text().catch(() => "");
        console.error("[v1/generate] xAI video error:", xaiRes.status, errText);
        if (xaiRes.status === 400 && errText.includes("safety")) {
          return res.status(400).json({ error: "Content policy violation" });
        }
        return res.status(502).json({ error: "Video generation failed. Credits refunded." });
      }

      let videoData: any = await xaiRes.json();
      const requestId = videoData.request_id || videoData.id;

      // Poll for completion (videos are async)
      if (requestId) {
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          let pollRes: Response;
          try {
            pollRes = await fetch(`${XAI_BASE}/videos/${requestId}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${XAI_API_KEY}` },
            });
          } catch { continue; }

          if (pollRes.status === 202) { await pollRes.text().catch(() => {}); continue; }

          if (!pollRes.ok) {
            await refundCredits(sql, auth.userId, d);
            return res.status(502).json({ error: "Video generation failed. Credits refunded." });
          }

          const pollData: any = await pollRes.json();
          const status = pollData.status || pollData.state;

          if (status === "failed" || status === "error") {
            await refundCredits(sql, auth.userId, d);
            return res.status(500).json({ error: pollData.error?.message || "Video generation failed. Credits refunded." });
          }
          if (status === "expired") {
            await refundCredits(sql, auth.userId, d);
            return res.status(500).json({ error: "Video generation expired. Credits refunded." });
          }

          const url = pollData.video?.url || pollData.video_url || pollData.url;
          if (status === "done" || status === "completed" || status === "succeeded" || url) {
            videoData = pollData;
            break;
          }
        }
      }

      const videoUrl = videoData.video?.url || videoData.video_url || videoData.url;
      if (!videoUrl) {
        await refundCredits(sql, auth.userId, d);
        return res.status(504).json({ error: "Video generation timed out. Credits refunded." });
      }

      await logUsage(sql, auth, `video:${duration}s`, totalCost, ip);
      return res.status(200).json({
        type: "video",
        video_url: videoUrl,
        duration,
        credits_used: totalCost,
        credits_remaining: available - totalCost,
      });
    }

    return res.status(400).json({ error: `Unknown type "${type}". Use "image" or "video".` });
  } catch (err: any) {
    console.error("[v1/generate]", err.message, err.stack);
    return res.status(500).json({ error: "Internal error" });
  }
}

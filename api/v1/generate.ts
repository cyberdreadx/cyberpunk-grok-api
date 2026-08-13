/**
 * /api/v1/generate — Public API for image & video generation.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 * Deducts credits from the key owner's account.
 *
 * Image body:
 *   prompt: string (required)
 *   type?: "image" (default)
 *   model?: "grok-imagine-image" | "grok-imagine-image-pro"
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
import { deductCredits, refundCredits, logUsage, getUserCredits, discountedCostForUser } from "./_lib/credits";
import { isEmailVerified, EMAIL_VERIFICATION_REQUIRED_MESSAGE, EMAIL_VERIFICATION_REQUIRED_CODE } from "../_lib/emailVerifiedGate";

const XAI_BASE = "https://api.x.ai/v1";

const IMAGE_MODELS = ["grok-imagine-image", "grok-imagine-image-pro"] as const;
const CREDITS_PER_VIDEO_SECOND = 3;

const IMAGE_CREDIT_COSTS: Record<string, number> = {
  "grok-imagine-image": 2,
  "grok-imagine-image-pro": 5,
};

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
    // ── Auth ──
    const auth = await getUserFromApiKey(req);
    if (!auth) {
      return res.status(401).json({
        error: "Invalid or missing API key. Pass X-API-Key header with your gltch_sk_* key.",
      });

    // Same gate as the session paths: an API key issued to an unverified
    // account is the identical hole with an extra step.
    if (!(await isEmailVerified(auth.userId))) {
      return res.status(403).json({
        error: EMAIL_VERIFICATION_REQUIRED_MESSAGE,
        code: EMAIL_VERIFICATION_REQUIRED_CODE,
      });
    }
    }

    const { allowed } = await checkRateLimit(
      `apikey:${auth.apiKeyId}`, "v1-generate",
      { max: auth.rateLimit, windowSeconds: 60 }
    );
    if (!allowed) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });

    // GROK RETIRED FROM THE PUBLIC API (2026-07-15): this endpoint runs xAI
    // Grok on the PLATFORM's XAI_API_KEY — but the site retired credits-mode
    // Grok (BYOK-only since 2026-06-14), so a third party here could rack up
    // xAI bills on our key. Disabled unless explicitly re-enabled via env.
    if (process.env.V1_GROK_ENABLED !== "1") {
      return res.status(410).json({
        error: "Grok models have been retired from the public API. Use POST /api/v1/comfy (GLTCH PRO workflows) instead — see /api/v1/models.",
      });
    }

    // ── Parse body ──
    const body = req.body || {};
    const prompt = (body.prompt as string || "").trim();
    if (!prompt || prompt.length > 5000) {
      return res.status(400).json({ error: "prompt is required (max 5000 chars)" });
    }

    const type = (body.type as string || "image").toLowerCase();
    const sql = getDb();
    const XAI_API_KEY = process.env.XAI_API_KEY;

    const [user] = await sql`
      SELECT daily_credits, sub_credits, pack_credits, COALESCE(subscription_discount_pct, 0) AS subscription_discount_pct FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });
    const available = getUserCredits(user);
    const ip = (req.headers["x-forwarded-for"] as string) || "unknown";

    // ═══════════════════════════════════════════════════════════════════
    // IMAGE GENERATION
    // ═══════════════════════════════════════════════════════════════════
    if (type === "image") {
      const model = (body.model as string) || "grok-imagine-image";
      if (!IMAGE_MODELS.includes(model as any)) {
        return res.status(400).json({ error: `model must be one of: ${IMAGE_MODELS.join(", ")}` });
      }

      const n = Math.min(Math.max(parseInt(body.n) || 1, 1), 4);
      const responseFormat = body.response_format === "b64_json" ? "b64_json" : "url";
      const totalCost = await discountedCostForUser(
        auth.userId,
        (IMAGE_CREDIT_COSTS[model] || 2) * n,
      );

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
      const totalCost = await discountedCostForUser(auth.userId, CREDITS_PER_VIDEO_SECOND * duration);
      const imageUrl = (body.image_url as string || "").trim();

      if (available < totalCost) {
        return res.status(402).json({ error: "Insufficient credits", required: totalCost, available, topUp: "https://grokrunner.gltch.app" });
      }

      if (!XAI_API_KEY) return res.status(500).json({ error: "Generation service not configured" });

      const d = await deductCredits(sql, auth.userId, totalCost, user);

      // Build xAI request
      const videoBody: any = { model: "grok-imagine-video", prompt, duration };
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

      // Poll for completion (videos are async).
      // Cap at ~280s so refund can run before Vercel's 300s maxDuration kills us.
      const deadline = Date.now() + 280_000;
      if (requestId) {
        while (Date.now() < deadline) {
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
    const msg = err.message || "Internal error";
    if (msg.includes("Insufficient credits")) {
      return res.status(402).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
}

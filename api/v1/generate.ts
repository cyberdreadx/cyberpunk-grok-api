/**
 * /api/v1/generate — Public API for image generation.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 * Deducts credits from the key owner's account.
 *
 * Body:
 *   prompt: string (required)
 *   model?: "grok-2-image" | "grok-2-image-pro"  (default: grok-2-image)
 *   n?: 1-4               (default: 1)
 *   response_format?: "url" | "b64_json"  (default: url)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";

const XAI_BASE = "https://api.x.ai/v1";

const ALLOWED_MODELS = ["grok-2-image", "grok-2-image-pro"] as const;

const CREDIT_COSTS: Record<string, number> = {
  "grok-2-image": 2,
  "grok-2-image-pro": 5,
};

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
  maxDuration: 120,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    // ── Auth via API key ──
    const auth = await getUserFromApiKey(req);
    if (!auth) {
      return res.status(401).json({
        error: "Invalid or missing API key. Pass X-API-Key header with your gltch_sk_* key.",
      });
    }

    // ── Rate limit per key ──
    const { allowed } = await checkRateLimit(
      `apikey:${auth.apiKeyId}`,
      "v1-generate",
      { max: auth.rateLimit, windowSeconds: 60 }
    );
    if (!allowed) {
      return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
    }

    // ── Parse & validate body ──
    const body = req.body || {};
    const prompt = (body.prompt as string || "").trim();
    if (!prompt || prompt.length > 5000) {
      return res.status(400).json({ error: "prompt is required (max 5000 chars)" });
    }

    const model = (body.model as string) || "grok-2-image";
    if (!ALLOWED_MODELS.includes(model as any)) {
      return res.status(400).json({ error: `model must be one of: ${ALLOWED_MODELS.join(", ")}` });
    }

    const n = Math.min(Math.max(parseInt(body.n) || 1, 1), 4);
    const responseFormat = body.response_format === "b64_json" ? "b64_json" : "url";

    // ── Credit check & deduct ──
    const costPerImage = CREDIT_COSTS[model] || 2;
    const totalCost = costPerImage * n;

    const sql = getDb();
    const [user] = await sql`
      SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });

    const available = (user.daily_credits || 0) + (user.sub_credits || 0) + (user.pack_credits || 0);
    if (available < totalCost) {
      return res.status(402).json({
        error: "Insufficient credits",
        required: totalCost,
        available,
        topUp: "https://grokrunner.gltch.app",
      });
    }

    // Deduct credits (daily first, then sub, then pack)
    let remaining = totalCost;
    let dDaily = Math.min(remaining, user.daily_credits || 0); remaining -= dDaily;
    let dSub = Math.min(remaining, user.sub_credits || 0); remaining -= dSub;
    let dPack = remaining;

    await sql`
      UPDATE users SET
        daily_credits = daily_credits - ${dDaily},
        sub_credits = sub_credits - ${dSub},
        pack_credits = pack_credits - ${dPack}
      WHERE id = ${auth.userId}
    `;

    // ── Call xAI ──
    const XAI_API_KEY = process.env.XAI_API_KEY;
    if (!XAI_API_KEY) {
      // Refund
      await sql`
        UPDATE users SET daily_credits = daily_credits + ${dDaily},
          sub_credits = sub_credits + ${dSub}, pack_credits = pack_credits + ${dPack}
        WHERE id = ${auth.userId}
      `;
      return res.status(500).json({ error: "Generation service not configured" });
    }

    const xaiRes = await fetch(`${XAI_BASE}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({ prompt, model, n, response_format: responseFormat }),
    });

    if (!xaiRes.ok) {
      // Refund on failure
      await sql`
        UPDATE users SET daily_credits = daily_credits + ${dDaily},
          sub_credits = sub_credits + ${dSub}, pack_credits = pack_credits + ${dPack}
        WHERE id = ${auth.userId}
      `;

      const errText = await xaiRes.text().catch(() => "");
      console.error("[v1/generate] xAI error:", xaiRes.status, errText);

      if (xaiRes.status === 400 && errText.includes("safety")) {
        return res.status(400).json({ error: "Content policy violation" });
      }
      return res.status(502).json({ error: "Generation failed. Credits refunded." });
    }

    const result = await xaiRes.json();

    // Log usage
    await sql`
      INSERT INTO api_usage_log (api_key_id, user_id, action, credits_used, ip_address)
      VALUES (${auth.apiKeyId}, ${auth.userId}, ${"generate:" + model}, ${totalCost}, ${req.headers["x-forwarded-for"] || "unknown"})
    `;

    // Update credits on key
    await sql`
      UPDATE api_keys SET total_credits = total_credits + ${totalCost} WHERE id = ${auth.apiKeyId}
    `;

    return res.status(200).json({
      ...result,
      credits_used: totalCost,
      credits_remaining: available - totalCost,
    });
  } catch (err: any) {
    console.error("[v1/generate]", err.message, err.stack);
    return res.status(500).json({ error: "Internal error" });
  }
}

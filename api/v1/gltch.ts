/**
 * /api/v1/gltch — Public API for GLTCH image editing.
 *
 * Auth: X-API-Key header with a valid gltch_sk_* key.
 *
 * Body:
 *   prompt: string (required)
 *   image_url: string (required — public URL of image to edit)
 *   aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" (default "1:1")
 *   hd?: boolean (default false — HD upscale)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";
import { put, del } from "@vercel/blob";
import { deductCredits, refundCredits, logUsage, getUserCredits, discountedCostForUser } from "./_lib/credits";
import { isEmailVerified, EMAIL_VERIFICATION_REQUIRED_MESSAGE, EMAIL_VERIFICATION_REQUIRED_CODE } from "../_lib/emailVerifiedGate";

const GLTCH_COST = 5;
const GLTCH_HD_COST = 7;
const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

const ASPECT_MAP: Record<string, string> = {
  "1:1": "1024*1024",
  "16:9": "1344*768",
  "9:16": "768*1344",
  "4:3": "1152*896",
  "3:4": "896*1152",
  "3:2": "1216*832",
  "2:3": "832*1216",
};

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
  maxDuration: 120,
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
      `apikey:${auth.apiKeyId}`, "v1-gltch",
      { max: auth.rateLimit, windowSeconds: 60 }
    );
    if (!allowed) return res.status(429).json({ error: "Rate limit exceeded." });

    const body = req.body || {};
    const prompt = (body.prompt as string || "").trim();
    if (!prompt || prompt.length > 5000) {
      return res.status(400).json({ error: "prompt is required (max 5000 chars)" });
    }

    const imageUrl = (body.image_url as string || "").trim();
    if (!imageUrl) {
      return res.status(400).json({ error: "image_url is required — provide a public URL of the image to edit" });
    }

    const aspectRatio = body.aspect_ratio || "1:1";
    const size = ASPECT_MAP[aspectRatio] || "1024*1024";
    const hd = body.hd === true;

    const sql = getDb();
    const ip = (req.headers["x-forwarded-for"] as string) || "unknown";

    const [user] = await sql`SELECT daily_credits, sub_credits, pack_credits, COALESCE(subscription_discount_pct, 0) AS subscription_discount_pct FROM users WHERE id = ${auth.userId}`;
    if (!user) return res.status(404).json({ error: "User not found" });

    const totalCost = await discountedCostForUser(auth.userId, hd ? GLTCH_HD_COST : GLTCH_COST);
    const available = getUserCredits(user);
    if (available < totalCost) {
      return res.status(402).json({ error: "Insufficient credits", required: totalCost, available });
    }

    const endpointId = process.env.GLTCH_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID || "";
    const apiKey = process.env.RUNPOD_API_KEY || "";
    if (!endpointId || !apiKey) {
      return res.status(503).json({ error: "GLTCH service not configured" });
    }

    const d = await deductCredits(sql, auth.userId, totalCost, user);

    // Download image and re-upload to Vercel Blob (RunPod needs a URL)
    let blobUrl = "";
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
    try {
      const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!imgResp.ok) throw new Error(`Failed to fetch image: ${imgResp.status}`);
      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      const blob = await put(`gltch-api/${auth.userId}-${Date.now()}.jpg`, imgBuffer, {
        access: "public", contentType: "image/jpeg", token: blobToken,
      });
      blobUrl = blob.url;
    } catch (err: any) {
      await refundCredits(sql, auth.userId, d);
      return res.status(400).json({ error: `Failed to fetch image_url: ${err.message}` });
    }

    const seed = Math.floor(Math.random() * 2 ** 32);

    // Submit to RunPod (runsync — typically finishes in 5-15s)
    const rpResp = await fetch(`${RUNPOD_API_BASE}/${endpointId}/runsync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        input: { prompt, images: [blobUrl], size, seed, output_format: "jpeg" },
      }),
      signal: AbortSignal.timeout(90000),
    });

    // Clean up blob
    del(blobUrl, { token: blobToken }).catch(() => {});

    if (!rpResp.ok) {
      await refundCredits(sql, auth.userId, d);
      return res.status(502).json({ error: "GLTCH generation failed. Credits refunded." });
    }

    const result: any = await rpResp.json();

    if (result.status === "COMPLETED" && result.output) {
      const out = result.output;
      const image = out.image_url || out.output ||
        (typeof out === "string" ? out : null) ||
        (out.images?.length ? (typeof out.images[out.images.length - 1] === "string" ? out.images[out.images.length - 1] : out.images[out.images.length - 1]?.url) : null) ||
        out.result;

      if (image) {
        await logUsage(sql, auth, `gltch:${hd ? "hd" : "standard"}`, totalCost, ip);
        return res.status(200).json({
          type: "gltch-edit",
          image_url: image,
          seed,
          hd,
          credits_used: totalCost,
          credits_remaining: available - totalCost,
        });
      }
    }

    if (result.status === "FAILED") {
      await refundCredits(sql, auth.userId, d);
      return res.status(502).json({ error: "GLTCH generation failed. Credits refunded." });
    }

    // Async fallback — poll
    const requestId = result.id;
    if (requestId) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const pollResp = await fetch(`${RUNPOD_API_BASE}/${endpointId}/status/${requestId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          if (!pollResp.ok) continue;
          const pollData: any = await pollResp.json();

          if (pollData.status === "COMPLETED" && pollData.output) {
            const out = pollData.output;
            const image = out.image_url || out.output || (typeof out === "string" ? out : null);
            if (image) {
              await logUsage(sql, auth, `gltch:${hd ? "hd" : "standard"}`, totalCost, ip);
              return res.status(200).json({
                type: "gltch-edit",
                image_url: image,
                seed,
                hd,
                credits_used: totalCost,
                credits_remaining: available - totalCost,
              });
            }
          }
          if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(pollData.status)) {
            await refundCredits(sql, auth.userId, d);
            return res.status(502).json({ error: "GLTCH generation failed. Credits refunded." });
          }
        } catch { continue; }
      }
    }

    await refundCredits(sql, auth.userId, d);
    return res.status(504).json({ error: "GLTCH generation timed out. Credits refunded." });
  } catch (err: any) {
    console.error("[v1/gltch]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

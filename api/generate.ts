/**
 * /api/generate — Proxy xAI requests for credit-mode users.
 * Verifies JWT, checks credits, forwards to xAI, deducts on success.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

const XAI_API_BASE = "https://api.x.ai/v1";

const CREDIT_COSTS = {
  image: 1,
  videoPerSecond: 1,
};

const ALLOWED_ACTIONS = ["generate-image", "edit-image", "generate-video"] as const;
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

function calculateCost(action: AllowedAction, imageCount: number, videoDuration: number): number {
  switch (action) {
    case "generate-image":
    case "edit-image":
      return CREDIT_COSTS.image * imageCount;
    case "generate-video":
      return CREDIT_COSTS.videoPerSecond * videoDuration;
  }
}

// Video generation can take minutes — increase timeout
export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const XAI_API_KEY = process.env.XAI_API_KEY;
    if (!XAI_API_KEY) return res.status(500).json({ error: "Server API key not configured" });

    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    // Rate limit: 60 generate requests per user per 5 minutes
    const { allowed } = await checkRateLimit(auth.userId, "generate", { max: 60, windowSeconds: 300 });
    if (!allowed) {
      return res.status(429).json({ error: "Rate limit reached. Please wait a moment before generating again." });
    }

    const { action, ...params } = req.body || {};

    // Validate action against whitelist
    if (!action || !ALLOWED_ACTIONS.includes(action as AllowedAction)) {
      return res.status(400).json({ error: "Invalid action. Expected: generate-image, edit-image, or generate-video." });
    }

    // Validate and clamp numeric inputs
    const imageCount = Math.max(1, Math.min(4, Math.floor(Number(params.n) || 1)));
    const videoDuration = Math.max(1, Math.min(60, Math.floor(Number(params.duration) || 5)));
    // Sanitize prompt length (DB column accepts 500 chars max)
    if (params.prompt && typeof params.prompt === "string" && params.prompt.length > 10000) {
      return res.status(400).json({ error: "Prompt too long (max 10,000 characters)." });
    }

    const cost = calculateCost(action as AllowedAction, imageCount, videoDuration);

    const sql = getDb();

    // Check credit balance
    const rows = await sql`
      SELECT sub_credits, pack_credits FROM users WHERE id = ${auth.userId}
    `;
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });

    const totalCredits = (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
    if (totalCredits < cost) {
      return res.status(402).json({ error: "Insufficient credits. Please purchase more in the Credit Store." });
    }

    // Map action to xAI endpoint
    let xaiEndpoint: string;
    switch (action) {
      case "generate-image": xaiEndpoint = "/images/generations"; break;
      case "edit-image": xaiEndpoint = "/images/edits"; break;
      case "generate-video": xaiEndpoint = "/videos/generations"; break;
      default: return res.status(400).json({ error: "Invalid action" }); // unreachable — whitelist above
    }

    // Deduct credits BEFORE calling xAI (prevents free usage if deduction fails)
    try {
      await sql`SELECT deduct_credits(${auth.userId}::uuid, ${cost})`;
    } catch (err: any) {
      console.error("Failed to deduct credits:", err.message);
      return res.status(402).json({ error: "Failed to deduct credits. " + (err.message || "") });
    }

    // Helper to refund credits on xAI failure
    const refundCredits = async () => {
      try {
        await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`;
        console.log(`Refunded ${cost} credits to ${auth.userId}`);
      } catch (refundErr: any) {
        console.error("Failed to refund credits:", refundErr.message);
      }
    };

    // Forward to xAI
    const xaiResponse = await fetch(`${XAI_API_BASE}${xaiEndpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify(params),
    });

    if (!xaiResponse.ok) {
      const errText = await xaiResponse.text();
      await refundCredits();
      return res.status(xaiResponse.status).json({ error: errText });
    }

    let xaiData: any = await xaiResponse.json();

    // For video: poll until complete
    if (action === "generate-video") {
      const requestId = xaiData.request_id || xaiData.id;
      if (requestId) {
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          let pollRes: Response;
          try {
            pollRes = await fetch(`${XAI_API_BASE}/videos/${requestId}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${XAI_API_KEY}` },
            });
          } catch {
            continue;
          }

          if (pollRes.status === 202) {
            await pollRes.text().catch(() => {});
            continue;
          }

          if (!pollRes.ok) {
            const errText = await pollRes.text();
            await refundCredits();
            return res.status(pollRes.status).json({ error: errText });
          }

          const pollData: any = await pollRes.json();
          const status = pollData.status || pollData.state;

          if (status === "failed" || status === "error") {
            await refundCredits();
            return res.status(500).json({ error: pollData.error?.message || "Video generation failed" });
          }

          const url = pollData.video?.url || pollData.video_url || pollData.url;
          if (status === "done" || status === "completed" || status === "succeeded" || url) {
            xaiData = pollData;
            break;
          }
        }
      }
    }

    // Log usage
    await sql`
      INSERT INTO usage_log (user_id, mode, credits_used, prompt)
      VALUES (${auth.userId}::uuid, ${action}, ${cost}, ${(params.prompt || "").slice(0, 500)})
    `;

    return res.status(200).json(xaiData);
  } catch (err: any) {
    console.error("[generate]", err.message);
    return res.status(500).json({ error: "Generation failed. Please try again." });
  }
}

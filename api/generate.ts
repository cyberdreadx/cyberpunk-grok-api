/**
 * /api/generate — Proxy xAI requests for credit-mode users.
 * Verifies JWT, checks credits, forwards to xAI, deducts on success.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";

const XAI_API_BASE = "https://api.x.ai/v1";

const CREDIT_COSTS = {
  image: 1,
  videoPerSecond: 1,
};

function calculateCost(action: string, imageCount: number, videoDuration: number): number {
  switch (action) {
    case "generate-image":
    case "edit-image":
      return CREDIT_COSTS.image * imageCount;
    case "generate-video":
      return CREDIT_COSTS.videoPerSecond * videoDuration;
    default:
      return 1;
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

    const { action, ...params } = req.body || {};
    if (!action) return res.status(400).json({ error: "Missing 'action' field" });

    const imageCount = params.n || 1;
    const videoDuration = params.duration || 5;
    const cost = calculateCost(action, imageCount, videoDuration);

    const sql = getDb();

    // Check credit balance
    const rows = await sql`
      SELECT sub_credits, pack_credits FROM users WHERE id = ${auth.userId}
    `;
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });

    const totalCredits = (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
    if (totalCredits < cost) {
      return res.status(402).json({ error: `Insufficient credits. Need ${cost}, have ${totalCredits}.` });
    }

    // Map action to xAI endpoint
    let xaiEndpoint: string;
    switch (action) {
      case "generate-image": xaiEndpoint = "/images/generations"; break;
      case "edit-image": xaiEndpoint = "/images/edits"; break;
      case "generate-video": xaiEndpoint = "/videos/generations"; break;
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }

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
            return res.status(pollRes.status).json({ error: errText });
          }

          const pollData: any = await pollRes.json();
          const status = pollData.status || pollData.state;

          if (status === "failed" || status === "error") {
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

    // Deduct credits
    try {
      await sql`SELECT deduct_credits(${auth.userId}::uuid, ${cost})`;
    } catch (err: any) {
      console.error("Failed to deduct credits:", err.message);
    }

    // Log usage
    await sql`
      INSERT INTO usage_log (user_id, mode, credits_used, prompt)
      VALUES (${auth.userId}::uuid, ${action}, ${cost}, ${(params.prompt || "").slice(0, 500)})
    `;

    return res.status(200).json(xaiData);
  } catch (err: any) {
    console.error("[generate]", err.message);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

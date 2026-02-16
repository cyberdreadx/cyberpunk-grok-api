/**
 * /api/gltch — Public-facing GLTCH image edit endpoint.
 *
 * Uses RunPod's public Qwen Image Edit endpoint.
 * Available to any authenticated user with credits. NOT admin-only.
 *
 * POST { action: "submit" }  — submit an edit job, deduct credits, return jobId
 * POST { action: "poll" }    — check job status, return image when done
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put, del } from "@vercel/blob";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

const GLTCH_COST = 1;
const GLTCH_HD_COST = 2;

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

function getEndpointId(): string {
  return process.env.GLTCH_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID || "";
}

function getApiKey(): string {
  return process.env.RUNPOD_API_KEY || "";
}

function aspectToSize(aspect: string): string {
  const map: Record<string, string> = {
    "1:1":  "1024*1024",
    "16:9": "1344*768",
    "9:16": "768*1344",
    "4:3":  "1152*896",
    "3:4":  "896*1152",
    "3:2":  "1216*832",
    "2:3":  "832*1216",
    "2:1":  "1408*704",
    "1:2":  "704*1408",
  };
  return map[aspect] || "1024*1024";
}

function friendlyError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "Generation timed out. The server may be busy — please try again.";
  if (lower.includes("econnrefused") || lower.includes("fetch failed"))
    return "GPU server is temporarily unavailable. Please try again in a moment.";
  if (lower.includes("insufficient") || lower.includes("credits"))
    return "Not enough credits for this edit.";
  if (lower.includes("rate limit"))
    return "Too many requests. Please wait a moment before trying again.";
  return "Edit failed. Please try again.";
}

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Sign in to use GLTCH edit." });

  const endpointId = getEndpointId();
  const apiKey = getApiKey();
  if (!endpointId || !apiKey) {
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

      const { allowed } = await checkRateLimit(auth.userId, "gltch", { max: 20, windowSeconds: 300 });
      if (!allowed) {
        return res.status(429).json({ error: "Too many GLTCH requests. Please wait a moment." });
      }

      const cost = hd ? GLTCH_HD_COST : GLTCH_COST;
      const sql = getDb();

      const rows = await sql`SELECT sub_credits, pack_credits FROM users WHERE id = ${auth.userId}`;
      if (rows.length === 0) return res.status(404).json({ error: "User not found." });

      const total = (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
      if (total < cost) {
        return res.status(402).json({ error: `Not enough credits. This edit costs ${cost} credit${cost !== 1 ? "s" : ""}.` });
      }

      try {
        await sql`SELECT deduct_credits(${auth.userId}::uuid, ${cost})`;
      } catch {
        return res.status(402).json({ error: "Failed to deduct credits." });
      }

      const refundCredits = async () => {
        try { await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`; }
        catch { /* best effort */ }
      };

      const seed = Math.floor(Math.random() * 2 ** 32);
      const size = aspectToSize(aspectRatio);

      // Strip data URL prefix to get raw base64, upload to Vercel Blob for a URL
      const rawBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
      const imgBuffer = Buffer.from(rawBase64, "base64");

      let blobUrl = "";
      try {
        const blob = await put(`gltch/${auth.userId}-${Date.now()}.jpg`, imgBuffer, {
          access: "public",
          contentType: "image/jpeg",
        });
        blobUrl = blob.url;
        console.log("[gltch] Uploaded image to blob:", blobUrl.slice(0, 80));
      } catch (uploadErr: any) {
        await refundCredits();
        console.error("[gltch] Blob upload failed:", uploadErr.message);
        return res.status(500).json({ error: "Failed to prepare image for editing." });
      }

      const runpodInput = {
        input: {
          prompt: prompt.trim(),
          images: [blobUrl],
          size,
          seed,
          output_format: "jpeg",
        },
      };

      // Use runsync — public endpoint typically finishes in ~5-15s
      const resp = await fetch(`${RUNPOD_API_BASE}/${endpointId}/runsync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(runpodInput),
        signal: AbortSignal.timeout(55000),
      });

      // Clean up blob regardless of outcome
      del(blobUrl).catch(() => {});

      if (!resp.ok) {
        await refundCredits();
        const errText = await resp.text().catch(() => "Unknown error");
        console.error("[gltch] RunPod submit failed:", resp.status, errText.slice(0, 500));
        return res.status(502).json({ error: friendlyError(errText) });
      }

      const result: any = await resp.json();
      console.log("[gltch] RunPod response — status:", result.status,
        "output:", result.output ? JSON.stringify(result.output).slice(0, 200) : "null");

      await sql`
        INSERT INTO usage_log (user_id, mode, credits_used, prompt)
        VALUES (${auth.userId}::uuid, ${hd ? "gltch-edit-hd" : "gltch-edit"}, ${cost}, ${prompt.trim().slice(0, 500)})
      `.catch(() => {});

      // runsync returns completed result directly
      if (result.status === "COMPLETED" && result.output) {
        const image = result.output.image_url || result.output.output || null;
        if (image) {
          return res.status(200).json({ promptId: result.id, seed, syncResult: { status: "done", image } });
        }
        console.error("[gltch] Could not parse output:", JSON.stringify(result.output).slice(0, 500));
        return res.status(200).json({ promptId: result.id, seed, syncResult: { status: "error", error: "Could not parse result." } });
      }

      if (result.status === "FAILED") {
        await refundCredits();
        console.error("[gltch] Job failed:", JSON.stringify(result).slice(0, 500));
        return res.status(502).json({ error: friendlyError(result.error || "Job failed") });
      }

      // If runsync timed out, fall back to async polling
      return res.status(200).json({ promptId: result.id, seed });
    }

    // ========== POLL ==========
    if (action === "poll") {
      const { promptId } = req.body;
      if (!promptId) return res.status(400).json({ error: "promptId is required." });

      const resp = await fetch(`${RUNPOD_API_BASE}/${endpointId}/status/${promptId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`Status check failed (${resp.status})`);

      const data: any = await resp.json();
      console.log("[gltch] Poll — status:", data.status, "output type:", typeof data.output, "output keys:", data.output && typeof data.output === "object" ? Object.keys(data.output) : "n/a", "output preview:", JSON.stringify(data.output)?.slice(0, 200));

      if (data.status === "COMPLETED") {
        const output = data.output;

        // Public endpoint returns output as image URL or base64
        if (typeof output === "string") {
          const image = output.startsWith("data:") ? output
            : output.startsWith("http") ? output
            : `data:image/jpeg;base64,${output}`;
          return res.status(200).json({ status: "done", image });
        }

        // Output might be an object with image_url or base64 fields
        if (output?.image_url) {
          return res.status(200).json({ status: "done", image: output.image_url });
        }
        if (output?.images?.length) {
          const img = output.images[output.images.length - 1];
          const image = typeof img === "string"
            ? (img.startsWith("data:") ? img : img.startsWith("http") ? img : `data:image/jpeg;base64,${img}`)
            : img.data
              ? (img.data.startsWith("data:") ? img.data : `data:image/jpeg;base64,${img.data}`)
              : img.url || img.image_url;
          if (image) return res.status(200).json({ status: "done", image });
        }
        if (output?.output) {
          return res.status(200).json({ status: "done", image: output.output });
        }

        console.error("[gltch] Unexpected output shape:", JSON.stringify(output).slice(0, 500));
        return res.status(200).json({ status: "error", error: "Job completed but could not parse output." });
      }

      if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(data.status)) {
        return res.status(200).json({
          status: "error",
          error: friendlyError(data.error || `Job ${data.status.toLowerCase()}.`),
        });
      }

      return res.status(200).json({ status: "pending" });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error("[gltch]", err.message);
    return res.status(500).json({ error: friendlyError(err.message || "Request failed") });
  }
}

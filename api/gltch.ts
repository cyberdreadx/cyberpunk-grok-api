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
import { getUserFromRequest, ADMIN_EMAIL, checkBan } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";
import { checkPrompt, logSafetyViolation } from "./_lib/safety";

const GLTCH_COST = 5;
const GLTCH_HD_COST = 7;

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

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "20mb" } },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Sign in to use GLTCH edit." });

  // Check if user is banned
  const sqlBan = getDb();
  const ban = await checkBan(sqlBan, auth.userId);
  if (ban.banned) {
    return res.status(403).json({ error: "Your account has been suspended.", reason: ban.reason });
  }

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

      // Safety check — runs before credits are touched
      const sql = getDb();

      // Check if user is already banned from repeat violations
      const banCheck = await sql`
        SELECT COUNT(*)::int AS strikes FROM safety_log
        WHERE user_id = ${auth.userId}::uuid
          AND created_at > now() - interval '24 hours'
      `.catch(() => [{ strikes: 0 }]);

      if ((banCheck[0]?.strikes || 0) >= 5) {
        return res.status(403).json({ error: "Your account has been temporarily restricted." });
      }

      const safety = checkPrompt(prompt);
      if (safety.blocked) {
        await logSafetyViolation(auth.userId, "gltch", prompt, safety.reason || "unknown");
        return res.status(451).json({ error: "This prompt violates our content policy." });
      }

      const { allowed } = await checkRateLimit(auth.userId, "gltch", { max: 20, windowSeconds: 300 });
      if (!allowed) {
        return res.status(429).json({ error: "Too many GLTCH requests. Please wait a moment." });
      }

      const cost = hd ? GLTCH_HD_COST : GLTCH_COST;
      const isAdminUser = auth.email === ADMIN_EMAIL;
      const adminTestCredits = isAdminUser && req.body.testCredits === true;

      // Credit gate (admin is free unless testCredits)
      if (!isAdminUser || adminTestCredits) {
        const rows = await sql`SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}`;
        if (rows.length === 0) return res.status(404).json({ error: "User not found." });

        const total = (rows[0].daily_credits || 0) + (rows[0].sub_credits || 0) + (rows[0].pack_credits || 0);
        if (total < cost) {
          return res.status(402).json({ error: `Not enough credits. This edit costs ${cost} credit${cost !== 1 ? "s" : ""}.` });
        }

        try {
          await sql`SELECT deduct_credits(${auth.userId}::uuid, ${cost})`;
        } catch {
          return res.status(402).json({ error: "Failed to deduct credits." });
        }
      }

      const refundCredits = async () => {
        if (isAdminUser && !adminTestCredits) return;
        try { await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${cost})`; }
        catch { /* best effort */ }
      };

      const seed = Math.floor(Math.random() * 2 ** 32);
      const size = aspectToSize(aspectRatio);

      // Strip data URL prefix and fix padding, then upload to Vercel Blob for a URL
      let rawBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
      const pad = rawBase64.length % 4;
      if (pad) rawBase64 += "=".repeat(4 - pad);
      const imgBuffer = Buffer.from(rawBase64, "base64");

      let blobUrl = "";
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
      try {
        const blob = await put(`gltch/${auth.userId}-${Date.now()}.jpg`, imgBuffer, {
          access: "public",
          contentType: "image/jpeg",
          token: blobToken,
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
      del(blobUrl, { token: blobToken }).catch(() => {});

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
        const out = result.output;
        let image: string | null = null;

        // Format 1: { image_url: "https://..." }
        if (out.image_url) image = out.image_url;
        // Format 2: { output: "https://..." } or { output: "base64..." }
        else if (typeof out.output === "string") image = out.output;
        // Format 3: output is a direct URL string
        else if (typeof out === "string") image = out;
        // Format 4: { images: [...] }
        else if (out.images?.length) {
          const img = out.images[out.images.length - 1];
          image = typeof img === "string" ? img : img?.url || img?.image_url || img?.data || null;
        }
        // Format 5: { result: "https://..." }
        else if (out.result) image = typeof out.result === "string" ? out.result : null;

        if (image) {
          return res.status(200).json({ promptId: result.id, seed, syncResult: { status: "done", image } });
        }

        // Return the actual output shape so we can diagnose
        const shape = JSON.stringify(out).slice(0, 300);
        console.error("[gltch] Unknown output shape:", shape);
        return res.status(200).json({
          promptId: result.id, seed,
          syncResult: { status: "error", error: `Unexpected output format: ${shape}` },
        });
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

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("[gltch]", err.message);
    return res.status(500).json({ error: friendlyError(err.message || "Request failed") });
  }
}

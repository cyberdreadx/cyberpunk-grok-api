/**
 * /api/seedance-status — Poll a fal.ai Seedance job submitted via /api/generate.
 *
 * Why this exists: fal.ai Seedance Fast/Pro can take 3–7 minutes, which exceeds
 * Vercel's 300s function timeout. /api/generate now submits and returns a signed
 * job token immediately; the browser polls this endpoint (each call is ~2s),
 * which never approaches any timeout.
 *
 * On COMPLETED → fetches the result, logs usage, returns the video URL.
 * On FAILED   → refunds credits, returns 502.
 * Otherwise   → returns { status: "IN_QUEUE" | "IN_PROGRESS" } so the client polls again.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import jwt from "jsonwebtoken";
import { getDb } from "./_lib/db";
import { applyCors } from "./_lib/cors";

interface SeedanceJobToken {
  kind: "seedance-job";
  userId: string;
  email: string;
  tier: "seedance" | "seedance-fast" | "seedance-pro";
  isI2V: boolean;
  seedCost: number;
  seedDuration: number;
  isAdmin: boolean;
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  prompt: string;
  iat: number;
  exp: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return res.status(500).json({ error: "SEEDANCE not configured (missing FAL_KEY)." });

  const jobToken = (req.body && (req.body as any).job_token) as string | undefined;
  if (!jobToken) return res.status(400).json({ error: "Missing job_token" });

  let job: SeedanceJobToken;
  try {
    job = jwt.verify(jobToken, process.env.JWT_SECRET as string) as SeedanceJobToken;
    if (job.kind !== "seedance-job") throw new Error("wrong kind");
  } catch {
    return res.status(401).json({ error: "Invalid or expired job token" });
  }

  const sql = getDb();
  const refund = async () => {
    if (job.isAdmin) return;
    try {
      await sql`SELECT add_pack_credits(${job.userId}::uuid, ${job.seedCost})`;
    } catch (e: any) {
      console.error("[seedance-status] refund failed:", e.message);
    }
  };

  // 1) Status check
  let statusRes: Response;
  try {
    statusRes = await fetch(job.statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
  } catch (e: any) {
    // Transient — let client retry, do NOT refund.
    return res.status(200).json({ status: "IN_PROGRESS", transient: true });
  }
  if (!statusRes.ok) {
    return res.status(200).json({ status: "IN_PROGRESS", transient: true });
  }

  const st: any = await statusRes.json().catch(() => ({}));
  const status = st?.status as string | undefined;

  if (status === "FAILED" || status === "ERROR") {
    await refund();
    console.error("[seedance-status] job failed", JSON.stringify(st).slice(0, 300));
    return res.status(502).json({ error: "SEEDANCE generation failed. Credits refunded.", status });
  }

  if (status !== "COMPLETED") {
    return res.status(200).json({ status: status || "IN_PROGRESS" });
  }

  // 2) Completed — fetch the result (with light retry for fal's lag between
  //    status=COMPLETED and response_url being readable)
  let finalData: any = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await fetch(job.responseUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
      if (r.ok) {
        finalData = await r.json().catch(() => null);
        if (finalData) break;
      }
    } catch { /* retry */ }
  }

  if (!finalData) {
    // Don't refund — the job did succeed; ask the client to retry the status call.
    return res.status(200).json({ status: "COMPLETED", result_pending: true });
  }

  const videoUrl = finalData?.video?.url || finalData?.video_url || finalData?.url;
  if (!videoUrl) {
    await refund();
    console.error("[seedance-status] no video url", JSON.stringify(finalData).slice(0, 300));
    return res.status(502).json({ error: "SEEDANCE returned no video URL. Credits refunded." });
  }

  // 3) Log usage (per-tier api cost cents/sec: Lite 3.6, Fast 10, Pro 30)
  const costCentsPerSec = job.tier === "seedance-pro" ? 30 : job.tier === "seedance-fast" ? 10 : 3.6;
  const apiCostCents = Math.round(costCentsPerSec * job.seedDuration);
  const modeLabel = `${job.tier}-${job.isI2V ? "i2v" : "t2v"}`;
  try {
    await sql`
      INSERT INTO usage_log (user_id, mode, credits_used, prompt, api_cost_cents)
      VALUES (${job.userId}::uuid, ${modeLabel}, ${job.seedCost}, ${job.prompt}, ${apiCostCents})
    `;
  } catch (e: any) {
    console.warn("[seedance-status] usage_log insert failed:", e.message);
  }

  return res.status(200).json({
    status: "COMPLETED",
    video: { url: videoUrl },
    video_url: videoUrl,
    provider: job.tier,
    duration: job.seedDuration,
  });
}

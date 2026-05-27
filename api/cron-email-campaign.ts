/**
 * /api/cron-email-campaign — Process queued mass-email campaigns in reliable batches.
 *
 * Runs every 2 minutes via Vercel Cron. Uses Resend batch API + email_log dedup
 * instead of the fragile admin self-fetch loop.
 *
 * Secured via CRON_SECRET Bearer token.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import {
  readActiveCampaign,
  processCampaignBatch,
  type CampaignJob,
} from "./_lib/email-campaign";

const MAX_BATCHES_PER_RUN = 5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const sql = getDb();
    let job = await readActiveCampaign(sql);

    if (!job) {
      return res.status(200).json({
        success: true,
        active: false,
        message: "No active email campaign",
        timestamp: new Date().toISOString(),
      });
    }

    const batches: Array<{ sent: number; failed: number; remaining: number; complete: boolean; cancelled: boolean }> = [];
    let totalSent = 0;
    let totalFailed = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const result = await processCampaignBatch(sql, job);
      batches.push(result);
      totalSent += result.sent;
      totalFailed += result.failed;

      if (result.complete || result.cancelled) {
        job = (await readActiveCampaign(sql)) ?? { ...job, status: result.cancelled ? "cancelled" : "complete" };
        break;
      }

      // Stop if a batch completely failed (avoid hammering Resend on outage)
      if (result.sent === 0 && result.failed > 0) break;

      const refreshed = await readActiveCampaign(sql);
      if (!refreshed) break;
      job = refreshed;
    }

    console.log(
      `[cron-email-campaign] ${job.campaign}: ${totalSent} sent, ${totalFailed} failed, ` +
      `${batches[batches.length - 1]?.remaining ?? "?"} remaining, status=${job.status}`,
    );

    return res.status(200).json({
      success: true,
      active: job.status === "active",
      campaign: job.campaign,
      status: job.status,
      batchesRun: batches.length,
      sent: totalSent,
      failed: totalFailed,
      remaining: batches[batches.length - 1]?.remaining ?? 0,
      totalSent: job.totalSent ?? 0,
      totalFailed: job.totalFailed ?? 0,
      lastBatchAt: job.lastBatchAt ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron-email-campaign] Error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Campaign processing failed" });
  }
}

/**
 * /api/cron-runpod-snapshot — record the RunPod account balance.
 *
 * The admin panel's RunPod cost is derived from per-job execution time times a
 * flat cents-per-second rate. That estimate cannot see idle workers, cold
 * starts, or the seconds erased when a job is refunded, and it prices every
 * endpoint at the H200 rate even though several list cheaper ADA GPUs too.
 *
 * Snapshotting the balance gives real drawdown to divide the estimate by, so
 * the panel can show how wrong the flat rate is instead of implying precision
 * it doesn't have.
 *
 * One row per run. Runs hourly — hourly resolution is what makes a day's
 * drawdown separable from a mid-day top-up, and 24 rows/day is free.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { requireCronAuth } from "./_lib/cron-auth";
import { getRunpodBalance, isRunpodBalanceConfigured } from "./_lib/runpod-balance";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronAuth(req, res)) return;

  if (!isRunpodBalanceConfigured()) {
    return res.status(200).json({ ok: true, skipped: "RUNPOD_ACCOUNT_API_KEY not set" });
  }

  const balance = await getRunpodBalance();
  if (!balance) {
    // A failed lookup must not write a row — a phantom 0 would read as the
    // account draining to nothing.
    console.error("[cron-runpod-snapshot] balance lookup failed; no row written");
    return res.status(200).json({ ok: false, error: "balance unavailable" });
  }

  try {
    const sql = getDb();
    await sql`
      INSERT INTO runpod_balance_snapshots (balance_usd, spend_per_hr)
      VALUES (${balance.balanceUsd}, ${balance.spendPerHr})
    `;
    return res.status(200).json({ ok: true, balanceUsd: balance.balanceUsd, spendPerHr: balance.spendPerHr });
  } catch (err: any) {
    console.error("[cron-runpod-snapshot] insert failed:", err.message);
    return res.status(500).json({ ok: false, error: "insert failed" });
  }
}

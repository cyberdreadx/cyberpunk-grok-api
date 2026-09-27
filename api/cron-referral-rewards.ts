/**
 * /api/cron-referral-rewards — pay referrers when the person they invited
 * turns into a real user.
 *
 * Hourly rather than inline at generation time: the eligibility rules read
 * across usage, bans and device fingerprints, and none of that belongs in the
 * hot path of a render. Being late by an hour costs nothing; being wrong costs
 * a farming wave.
 *
 * Starts DISABLED, with dryRun on — see api/_lib/referral-rewards.ts for why
 * the trigger is activation rather than signup.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { requireCronAuth } from "./_lib/cron-auth";
import { readReferralConfig, pendingActivations, payActivation } from "./_lib/referral-rewards";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronAuth(req, res)) return;

  const sql = getDb();
  const cfg = await readReferralConfig(sql);
  if (!cfg.enabled) {
    return res.status(200).json({ ok: true, enabled: false, message: "Referral activation rewards are off" });
  }

  try {
    const pending = await pendingActivations(sql, cfg, cfg.maxPerRun);
    let paid = 0;
    if (!cfg.dryRun) {
      for (const a of pending) {
        if (await payActivation(sql, cfg, a)) paid++;
      }
    }
    const credits = (cfg.dryRun ? pending.length : paid) * (cfg.referrerCredits + cfg.refereeCredits);
    console.log(`[cron-referral-rewards] ${cfg.dryRun ? "DRY RUN " : ""}${cfg.dryRun ? pending.length : paid} activations, ${credits} credits`);
    return res.status(200).json({
      ok: true,
      enabled: true,
      dryRun: cfg.dryRun,
      eligible: pending.length,
      paid,
      creditsGranted: credits,
      ...(req.query.verbose ? { detail: pending.slice(0, 20) } : {}),
    });
  } catch (err: any) {
    console.error("[cron-referral-rewards]", err?.message);
    return res.status(500).json({ error: err?.message || "referral reward run failed" });
  }
}

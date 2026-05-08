/**
 * /api/cron-reset-daily — Reset daily_credits for all verified users.
 *
 * Runs at midnight UTC via Vercel Cron. No rollover — overwrites each cycle.
 * Base amount is 10; XRGE holders (operative+) get extra credits from tier +
 * continuous-hold streak (same rules as api/v1/_lib/xrge-holder.ts).
 *
 * Secured via CRON_SECRET Bearer token (same pattern as cron-reset-credits).
 *
 * Pass ?notify=true to also send "credits refilled" emails (adds ~60-120s
 * for large user bases; the cron itself runs without emails to stay fast).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getResend, getFromAddress, buildDailyCreditsHtml } from "./_lib/email";
import { isSourceDisabled } from "./_lib/freeCredits";

const DAILY_BASE = 10;
const BATCH_SIZE = 100;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (await isSourceDisabled("daily")) {
      console.log("[cron-reset-daily] Skipped — free credits disabled");
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "free_credits_disabled",
        timestamp: new Date().toISOString(),
      });
    }

    const sql = getDb();

    // 1. Zero out non-subscribers (free credits are subscriber-only).
    await sql`
      UPDATE users
      SET daily_credits = 0,
          daily_credits_reset_at = now(),
          updated_at = now()
      WHERE email_verified = true
        AND subscription_tier IS NULL
    `;

    // 2. Reset daily credits for subscribers: base + XRGE holder tier bonus.
    const result = await sql`
      UPDATE users
      SET daily_credits = (
        ${DAILY_BASE} + FLOOR(
          (CASE COALESCE(holder_tier, 'none')
            WHEN 'operative' THEN 2::numeric
            WHEN 'runner' THEN 5::numeric
            WHEN 'architect' THEN 10::numeric
            ELSE 0::numeric
          END) *
          CASE
            WHEN COALESCE(holder_tier, 'none') IN ('none', 'initiate') THEN 1::numeric
            WHEN holder_tier_since IS NULL THEN 1::numeric
            WHEN EXTRACT(EPOCH FROM (now() - holder_tier_since)) / 86400 >= 180 THEN 2::numeric
            WHEN EXTRACT(EPOCH FROM (now() - holder_tier_since)) / 86400 >= 90 THEN 1.5::numeric
            WHEN EXTRACT(EPOCH FROM (now() - holder_tier_since)) / 86400 >= 30 THEN 1.25::numeric
            ELSE 1::numeric
          END
        )
      )::int,
          daily_credits_reset_at = now(),
          updated_at = now()
      WHERE email_verified = true
    `;

    const resetCount = (result as any).count ?? 0;
    console.log(`[cron-reset-daily] Reset ${resetCount} users (base ${DAILY_BASE} + holder bonuses where applicable)`);

    // 2. Send email notifications only when ?notify=true
    const shouldNotify = req.query.notify === "true";
    let emailsSent = 0;
    let emailsFailed = 0;

    if (shouldNotify) {
      try {
        const users = await sql`
          SELECT email FROM users WHERE email_verified = true
        `;

        if (users.length > 0) {
          const resend = getResend();
          const fromAddress = getFromAddress();
          const html = buildDailyCreditsHtml(DAILY_BASE);
          const subject = `Your daily credits are ready`;

          for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const emails = batch.map((u: any) => ({
              from: `Grok Runner <${fromAddress}>`,
              to: [u.email],
              subject,
              html,
            }));

            try {
              await resend.batch.send(emails);
              emailsSent += batch.length;
            } catch (batchErr: any) {
              console.error(`[cron-reset-daily] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, batchErr.message);
              emailsFailed += batch.length;
            }
          }
        }

        console.log(`[cron-reset-daily] Emails: ${emailsSent} sent, ${emailsFailed} failed`);
      } catch (emailErr: any) {
        console.error("[cron-reset-daily] Email notification error:", emailErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      dailyBase: DAILY_BASE,
      reset: resetCount,
      notified: shouldNotify,
      emailsSent,
      emailsFailed,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron-reset-daily]", err.message);
    return res.status(500).json({ error: "Daily credit reset failed" });
  }
}

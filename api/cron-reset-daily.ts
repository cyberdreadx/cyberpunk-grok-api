/**
 * /api/cron-reset-daily — Reset daily_credits for all verified users.
 *
 * Runs at midnight UTC via Vercel Cron. No rollover — overwrites each cycle.
 * Base amount is 10; XRGE holders (operative+) get extra credits from tier +
 * continuous-hold streak (same rules as api/v1/_lib/xrge-holder.ts).
 *
 * The base and the holder bonus are switched independently. free_credits.daily
 * turns off the base for everyone — a pricing decision — but it used to return
 * from this handler before the holder bonus was ever computed, so a tier that
 * advertises "+2 daily credits" silently paid nothing from 2026-07-30 onward.
 * Holders bought that perk with 10M+ XRGE; retiring the free tier is not the
 * same decision as retiring a paid one, so the bonus now survives the switch.
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
    // Not an early return any more: the holder bonus is owed either way.
    const baseOff = await isSourceDisabled("daily");
    const base = baseOff ? 0 : DAILY_BASE;

    const sql = getDb();

    // One statement, not two. It used to zero non-subscribers and then grant to
    // subscribers, which meant a holder who was not a subscriber got zeroed by
    // the first and skipped by the second no matter what tier they held.
    //
    // Base is subscriber-only and off entirely when free_credits.daily is off.
    // The holder bonus is neither: it is attached to the tier, so it applies to
    // subscribers and non-subscribers alike and ignores the free-credit switch.
    const result = await sql`
      UPDATE users
      SET daily_credits = (
        (CASE
           WHEN ${base}::int = 0 THEN 0
           WHEN subscription_tier IS NOT NULL OR COALESCE(subscription_discount_pct, 0) > 0 THEN ${base}::int
           ELSE 0
         END)
        + FLOOR(
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
    `;

    const resetCount = (result as any).count ?? 0;
    console.log(`[cron-reset-daily] Reset ${resetCount} users (base ${base}${baseOff ? " — free_credits.daily is off" : ""} + holder bonuses where applicable)`);

    // 2. Send email notifications only when ?notify=true
    const shouldNotify = req.query.notify === "true";
    let emailsSent = 0;
    let emailsFailed = 0;

    // The refill email announces the base amount. With the base switched off
    // there is nothing to announce — a holder's +2 does not make "your daily
    // credits are ready" true for the subscribers this queries.
    if (shouldNotify && baseOff) {
      console.log("[cron-reset-daily] notify requested but base is off — no emails sent");
    } else if (shouldNotify) {
      try {
        const users = await sql`
          SELECT email FROM users WHERE subscription_tier IS NOT NULL OR COALESCE(subscription_discount_pct, 0) > 0
        `;

        if (users.length > 0) {
          const resend = getResend();
          const fromAddress = getFromAddress();
          const html = buildDailyCreditsHtml(base);
          const subject = `Your daily credits are ready`;

          for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const emails = batch.map((u: any) => ({
              from: `GLTCHRunner <${fromAddress}>`,
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
      dailyBase: base,
      baseDisabled: baseOff,
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

/**
 * /api/cron-reset-daily — Reset daily_credits for all verified users.
 *
 * Runs at midnight UTC via Vercel Cron. No rollover — overwrites each cycle.
 * The base is scaled by subscription tier (_lib/dailyCredits.ts); XRGE holders
 * (operative+) get extra credits from tier + continuous-hold streak (same rules
 * as api/v1/_lib/xrge-holder.ts).
 *
 * The base and the holder bonus are switched independently. free_credits.daily
 * turns off the base for everyone — a pricing decision — but it used to return
 * from this handler before the holder bonus was ever computed, so a tier that
 * advertises "+2 daily credits" silently paid nothing from 2026-07-30 onward.
 * Holders bought that perk with 10M+ XRGE; retiring the free tier is not the
 * same decision as retiring a paid one, so the bonus now survives the switch.
 *
 * Every payout is written to credit_ledger as source "daily", keyed by UTC date.
 * Daily grants used to leave no trail at all, so farming through them could not
 * be traced afterwards.
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
import {
  DAILY_CREDITS_BY_TIER,
  DAILY_CREDITS_FALLBACK,
  describeDailyCredits,
  type DailyTier,
} from "./_lib/dailyCredits";

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
    // Amounts per tier, from the one table the support bot also quotes. All zero
    // while the switch is off, so the holder bonus below still pays and nothing
    // else does.
    const tiers = Object.keys(DAILY_CREDITS_BY_TIER) as DailyTier[];
    const amounts = tiers.map((t) => (baseOff ? 0 : DAILY_CREDITS_BY_TIER[t]));
    const fallback = baseOff ? 0 : DAILY_CREDITS_FALLBACK;
    // The ledger's per-day key: a second run on the same UTC day re-sets
    // daily_credits (harmless — it is an overwrite) but logs nothing twice.
    const dayKey = new Date().toISOString().slice(0, 10);

    const sql = getDb();

    // One statement, not two. It used to zero non-subscribers and then grant to
    // subscribers, which meant a holder who was not a subscriber got zeroed by
    // the first and skipped by the second no matter what tier they held.
    //
    // Base is subscriber-only and off entirely when free_credits.daily is off.
    // The holder bonus is neither: it is attached to the tier, so it applies to
    // subscribers and non-subscribers alike and ignores the free-credit switch.
    const [outcome] = await sql`
      WITH upd AS (
      UPDATE users
      SET daily_credits = (
        COALESCE(
          -- Amount by tier family, driven entirely by DAILY_CREDITS_BY_TIER, so a
          -- tier added there is paid here without a second list to keep in sync.
          (SELECT t.amt FROM unnest(${tiers}::text[], ${amounts}::int[]) AS t(fam, amt)
            WHERE t.fam = split_part(COALESCE(subscription_tier, ''), '-', 1)),
          -- Empty-string tiers are not subscribers, matching isSubscriber(); the
          -- old IS NOT NULL test paid them anyway.
          CASE
            WHEN COALESCE(subscription_tier, '') <> '' OR COALESCE(subscription_discount_pct, 0) > 0
              THEN ${fallback}::int
            ELSE 0
          END
        )
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
      RETURNING id, daily_credits
      ),
      ins AS (
        INSERT INTO credit_ledger (user_id, amount, source, ref_key)
        SELECT upd.id, upd.daily_credits, 'daily', ${dayKey}
        FROM upd
        WHERE upd.daily_credits > 0
          AND NOT EXISTS (
            SELECT 1 FROM credit_ledger l
            WHERE l.user_id = upd.id AND l.source = 'daily' AND l.ref_key = ${dayKey}
          )
        RETURNING amount
      )
      SELECT (SELECT COUNT(*) FROM upd)::int AS reset,
             (SELECT COUNT(*) FROM ins)::int AS logged,
             (SELECT COALESCE(SUM(amount), 0) FROM ins)::int AS credits
    `;

    const resetCount = Number((outcome as any)?.reset ?? 0);
    const ledgerRows = Number((outcome as any)?.logged ?? 0);
    const creditsGranted = Number((outcome as any)?.credits ?? 0);
    console.log(
      `[cron-reset-daily] Reset ${resetCount} users; ${ledgerRows} were paid ${creditsGranted} credits` +
      (baseOff ? " (free_credits.daily is off — holder bonuses only)" : ` (per day: ${describeDailyCredits()})`),
    );

    // A subscriber on a tier missing from the table is paid the fallback. Log it,
    // so a renamed plan shows up here instead of quietly earning the minimum.
    if (!baseOff) {
      const unknown = (await sql`
        SELECT subscription_tier, COUNT(*)::int AS n FROM users
        WHERE COALESCE(subscription_tier, '') <> ''
          AND NOT (split_part(subscription_tier, '-', 1) = ANY(${tiers}::text[]))
        GROUP BY 1`) as any[];
      if (unknown.length) {
        console.warn(`[cron-reset-daily] tiers not in DAILY_CREDITS_BY_TIER, paid ${DAILY_CREDITS_FALLBACK}/day: ${JSON.stringify(unknown)}`);
      }
    }

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
        // Amounts differ by tier now, so one email body would tell most people
        // the wrong number. Each person is told what they actually received,
        // read back from daily_credits, which the update above just set.
        const users = await sql`
          SELECT email, daily_credits FROM users
          WHERE (COALESCE(subscription_tier, '') <> '' OR COALESCE(subscription_discount_pct, 0) > 0)
            AND daily_credits > 0
        `;

        if (users.length > 0) {
          const resend = getResend();
          const fromAddress = getFromAddress();
          const subject = `Your daily credits are ready`;
          const htmlByAmount = new Map<number, string>();
          const bodyFor = (n: number) => {
            if (!htmlByAmount.has(n)) htmlByAmount.set(n, buildDailyCreditsHtml(n));
            return htmlByAmount.get(n)!;
          };

          for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const emails = batch.map((u: any) => ({
              from: `GLTCHRunner <${fromAddress}>`,
              to: [u.email],
              subject,
              html: bodyFor(Number(u.daily_credits)),
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
      dailyByTier: baseOff ? null : DAILY_CREDITS_BY_TIER,
      baseDisabled: baseOff,
      reset: resetCount,
      ledgerRows,
      creditsGranted,
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

/**
 * /api/admin -- Admin dashboard stats + health check.
 *
 * GET  (no auth)         -> health check
 * POST { action: "overview" }           -> high-level KPIs
 * POST { action: "revenue" }            -> revenue time series
 * POST { action: "revenue-breakdown" }  -> revenue by pack, gateway, type
 * POST { action: "users" }              -> user growth time series
 * POST { action: "usage" }              -> generation volume by mode
 * POST { action: "top-users" }          -> top users by usage
 * POST { action: "transactions" }       -> last 100 transactions
 * POST { action: "referrals" }          -> referral program stats
 * POST { action: "sync-subscriptions" } -> pull cancellation status from Stripe
 *
 * All POST actions require admin JWT (hardcoded admin email).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { logCreditGrant } from "./_lib/credit-ledger";
import { sendAnnouncementEmail, buildAnnouncementHtml, buildV47AnnouncementHtml, buildV48AnnouncementHtml, buildV49SubscriptionFixHtml } from "./_lib/email";
import {
  CAMPAIGN_CONFIG_KEY,
  getCampaignRemaining,
  getDefaultSubject,
  getAnnouncementHtmlForCampaign,
  saveCampaignJob,
  readActiveCampaign,
  type CampaignJob,
} from "./_lib/email-campaign";
import {
  parseRange,
  rangeClause,
  bucketSeriesCte,
  SQL_BASE_MODE,
  SQL_IS_REFUND,
  SQL_IS_JOB,
  SQL_NET_CREDITS,
  SQL_PROVIDER,
  SQL_XAI_EST_CENTS,
  SQL_GATEWAY,
  SQL_IS_REVENUE,
  RUNPOD_CENTS_PER_SEC,
  type Range,
} from "./_lib/analytics";
import {
  getStripeWindow,
  getStripeMrr,
  getStripeBalance,
  getStripeCharges,
  clearStripeCache,
} from "./_lib/stripe-finance";
import { getRunpodBalance, isRunpodBalanceConfigured } from "./_lib/runpod-balance";

/**
 * Cost CTEs shared by every panel that prices generations.
 *
 * `scoped`  — job rows in the window, refund suffix stripped off into
 *             `base_mode` so a refunded job still prices against its real mode.
 * `rate`    — observed mean tracked cost per base mode. Used to fill in rows
 *             that predate cost tracking (only ~1% of rows before June 2026)
 *             and refunded rows, whose execution_time_ms was zeroed on refund
 *             even though RunPod still billed the GPU seconds.
 *
 * `blended_cents` is therefore: real number where we have one, that mode's own
 * observed average where we don't, xAI list price as a last resort.
 */
function costCtes(whereSql: string): string {
  return `
    scoped AS (
      SELECT
        id,
        user_id,
        mode,
        ${SQL_BASE_MODE} AS base_mode,
        ${SQL_PROVIDER}   AS provider,
        credits_used,
        ${SQL_NET_CREDITS} AS net_credits,
        (${SQL_IS_REFUND}) AS is_refund,
        execution_time_ms,
        api_cost_cents,
        ${SQL_XAI_EST_CENTS} AS xai_est_cents,
        created_at
      FROM usage_log
      WHERE (${whereSql}) AND ${SQL_IS_JOB}
    ),
    rate AS (
      SELECT base_mode, AVG(api_cost_cents) AS avg_cents
      FROM scoped
      WHERE api_cost_cents IS NOT NULL AND api_cost_cents > 0
      GROUP BY base_mode
    ),
    priced AS (
      SELECT
        s.*,
        COALESCE(
          s.api_cost_cents,
          r.avg_cents,
          CASE WHEN s.provider = 'xai' THEN s.xai_est_cents ELSE 0 END
        ) AS blended_cents
      FROM scoped s
      LEFT JOIN rate r ON r.base_mode = s.base_mode
    )`;
}

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

async function isFeedMod(req: VercelRequest): Promise<boolean> {
  const auth = getUserFromRequest(req);
  if (!auth) return false;
  try {
    const sql = getDb();
    const rows = await sql`SELECT 1 FROM feed_moderators WHERE user_id = ${auth.userId} LIMIT 1`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

// Actions feed moderators are allowed to perform (in addition to admins)
const MOD_ALLOWED_ACTIONS = new Set(["ban-user", "unban-user", "list-bans", "user-inspect"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Health check (GET, no auth)
  if (req.method === "GET") {
    try {
      const sql = getDb();
      await sql`SELECT 1 AS ok`;
      return res.status(200).json({ status: "ok" });
    } catch {
      return res.status(503).json({ status: "degraded" });
    }
  }

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sql = getDb();
  const { action } = req.body || {};

  // Background self-continuation: server-to-server call from a previous
  // send-announcement batch. Authorized via CRON_SECRET instead of JWT so
  // the campaign keeps running even after the admin closes the browser.
  const cronSecret = process.env.CRON_SECRET;
  const isBackgroundContinuation =
    action === "send-announcement" &&
    req.body?._bg === true &&
    !!cronSecret &&
    req.headers["x-bg-secret"] === cronSecret;

  // Admins can perform all actions; feed mods only a small subset
  const admin = isAdmin(req) || isBackgroundContinuation;
  const modAllowed = !admin && MOD_ALLOWED_ACTIONS.has(action) && (await isFeedMod(req));
  if (!admin && !modAllowed) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    switch (action) {
      // -- Overview KPIs --
      // `days` selects the primary window (default 30) so every headline card
      // moves together with the range picker instead of being frozen at 30d.
      case "overview": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);
        const days = range.days;

        const [userStats] = await sql`
          SELECT
            COUNT(*)::int AS total_users,
            COUNT(*) FILTER (WHERE email_verified = true)::int AS verified_users,
            COUNT(*) FILTER (WHERE subscription_tier IS NOT NULL)::int AS active_subscribers,
            COUNT(*) FILTER (WHERE subscription_tier IS NOT NULL AND subscription_cancel_at IS NOT NULL)::int AS cancelling_subscribers,
            COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS new_today,
            COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_this_week
          FROM users
        `;

        // Revenue counts ONLY rows where money moved. Admin credit grants are
        // written as type='pack' with a stripe_session_id at 0 cents, so the
        // old unfiltered COUNT(*) reported 7,226 "transactions" against 3,452
        // real ones and 6,809 "pack purchases" against 3,035.
        const [revenueStats] = (await sql.query(
          `SELECT
             COALESCE(SUM(amount_cents) FILTER (WHERE ${SQL_IS_REVENUE}), 0)::int AS total_revenue_cents,
             COALESCE(SUM(amount_cents) FILTER (WHERE ${SQL_IS_REVENUE} AND ${win.sql}), 0)::int AS revenue_window_cents,
             COALESCE(SUM(amount_cents) FILTER (WHERE ${SQL_IS_REVENUE} AND created_at > now() - interval '30 days'), 0)::int AS revenue_30d_cents,
             COALESCE(SUM(amount_cents) FILTER (WHERE ${SQL_IS_REVENUE} AND created_at > now() - interval '7 days'), 0)::int AS revenue_7d_cents,
             COALESCE(SUM(amount_cents) FILTER (WHERE ${SQL_IS_REVENUE} AND created_at > now() - interval '24 hours'), 0)::int AS revenue_today_cents,
             COUNT(*) FILTER (WHERE ${SQL_IS_REVENUE})::int AS total_transactions,
             COUNT(*) FILTER (WHERE ${SQL_IS_REVENUE} AND type = 'pack')::int AS pack_purchases,
             COUNT(*) FILTER (WHERE ${SQL_IS_REVENUE} AND type = 'subscription')::int AS sub_renewals,
             COUNT(*) FILTER (WHERE NOT (${SQL_IS_REVENUE}))::int AS grant_rows,
             COALESCE(SUM(credits) FILTER (WHERE NOT (${SQL_IS_REVENUE})), 0)::int AS granted_credits,
             COUNT(DISTINCT user_id) FILTER (WHERE ${SQL_IS_REVENUE})::int AS paying_users
           FROM transactions`,
          win.params,
        )) as any[];

        // Usage counts only real jobs, and nets out refunds. `share`,
        // `share-repeat`, `chat-message` and `goodwill-*` are analytics pings
        // and ledger adjustments — ~21k rows that were being reported as
        // generations.
        const [usageStats] = (await sql.query(
          `SELECT
             COALESCE(SUM(${SQL_NET_CREDITS}), 0)::int AS total_credits_used,
             COALESCE(SUM(${SQL_NET_CREDITS}) FILTER (WHERE ${win.sql}), 0)::int AS credits_window,
             COALESCE(SUM(${SQL_NET_CREDITS}) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS credits_30d,
             COALESCE(SUM(${SQL_NET_CREDITS}) FILTER (WHERE created_at > now() - interval '24 hours'), 0)::int AS credits_today,
             COUNT(*) FILTER (WHERE NOT (${SQL_IS_REFUND}))::int AS total_generations,
             COUNT(*) FILTER (WHERE NOT (${SQL_IS_REFUND}) AND ${win.sql})::int AS generations_window,
             COUNT(*) FILTER (WHERE NOT (${SQL_IS_REFUND}) AND created_at > now() - interval '24 hours')::int AS generations_today,
             COUNT(*) FILTER (WHERE ${SQL_IS_REFUND})::int AS refunded_generations,
             COALESCE(SUM(credits_used) FILTER (WHERE ${SQL_IS_REFUND}), 0)::int AS refunded_credits,
             COUNT(*) FILTER (WHERE ${SQL_IS_REFUND} AND ${win.sql})::int AS refunded_window,
             COUNT(DISTINCT user_id) FILTER (WHERE ${win.sql})::int AS active_users_window
           FROM usage_log
           WHERE ${SQL_IS_JOB}`,
          win.params,
        )) as any[];

        const [creditPool] = await sql`
          SELECT
            COALESCE(SUM(sub_credits), 0)::int AS total_sub_credits_outstanding,
            COALESCE(SUM(pack_credits), 0)::int AS total_pack_credits_outstanding,
            COALESCE(SUM(daily_credits), 0)::int AS total_daily_credits_outstanding
          FROM users
        `;

        // Cost, split by who actually sends the bill. The old estimate priced
        // every mode at xAI's per-image/per-second rates — including the
        // comfy-* modes that run on RunPod — and then displayed that total
        // NEXT TO the RunPod number, double counting the same jobs.
        const byProvider = (await sql.query(
          `WITH ${costCtes(win.sql)}
           SELECT
             provider,
             COUNT(*)::int                                   AS jobs,
             COUNT(*) FILTER (WHERE is_refund)::int          AS refunded_jobs,
             COALESCE(SUM(net_credits), 0)::int              AS net_credits,
             COALESCE(SUM(api_cost_cents), 0)::numeric       AS tracked_cents,
             COUNT(api_cost_cents)::int                      AS tracked_rows,
             COALESCE(SUM(blended_cents), 0)::numeric        AS blended_cents,
             COALESCE(SUM(execution_time_ms), 0)::bigint     AS exec_ms
           FROM priced
           GROUP BY provider
           ORDER BY blended_cents DESC`,
          win.params,
        )) as any[];

        const providerCost: Record<string, any> = {};
        let blendedTotal = 0, trackedTotal = 0, trackedRows = 0, jobRows = 0;
        for (const r of byProvider) {
          providerCost[r.provider] = {
            jobs: r.jobs,
            refundedJobs: r.refunded_jobs,
            netCredits: r.net_credits,
            trackedCents: Number(r.tracked_cents),
            trackedRows: r.tracked_rows,
            blendedCents: Number(r.blended_cents),
            execMs: Number(r.exec_ms),
          };
          blendedTotal += Number(r.blended_cents);
          trackedTotal += Number(r.tracked_cents);
          trackedRows += r.tracked_rows;
          jobRows += r.jobs;
        }

        // Moderation is an xAI-era concept (last block 2026-04-23). Its cost is
        // already inside providerCost.xai, so it is reported here as a subset,
        // never added on top.
        const [moderationStats] = (await sql.query(
          `SELECT
             COUNT(*)::int AS total_blocks,
             COUNT(*) FILTER (WHERE ${win.sql})::int AS blocks_window,
             COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS blocks_30d,
             COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS blocks_today,
             COALESCE(SUM(credits_used), 0)::int AS total_credits_burned,
             COALESCE(SUM(credits_used) FILTER (WHERE ${win.sql}), 0)::int AS credits_burned_window,
             COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS credits_burned_30d,
             COALESCE(SUM(COALESCE(api_cost_cents, credits_used * 5)), 0)::numeric AS wasted_cost_total_cents,
             COALESCE(SUM(COALESCE(api_cost_cents, credits_used * 5)) FILTER (WHERE ${win.sql}), 0)::numeric AS wasted_cost_window_cents
           FROM usage_log
           WHERE mode LIKE 'moderation-%'`,
          win.params,
        )) as any[];

        const moderationOffenders = await sql`
          SELECT
            u.email,
            COUNT(*)::int AS block_count,
            COALESCE(SUM(ul.credits_used), 0)::int AS credits_burned,
            MAX(ul.created_at) AS last_block
          FROM usage_log ul
          JOIN users u ON u.id = ul.user_id
          WHERE ul.mode LIKE 'moderation-%'
          GROUP BY u.email
          ORDER BY block_count DESC
          LIMIT 10
        `;

        const revenueWindow = revenueStats.revenue_window_cents;
        const creditsWindow = usageStats.credits_window;

        return res.status(200).json({
          range: { days, bucket: range.bucket, label: range.label },
          users: userStats,
          revenue: revenueStats,
          usage: usageStats,
          creditPool,
          cost: {
            byProvider: providerCost,
            blendedCents: Math.round(blendedTotal),
            trackedCents: Math.round(trackedTotal),
            trackedRows,
            jobRows,
            coverage: jobRows > 0 ? trackedRows / jobRows : 0,
            runpodCentsPerSec: RUNPOD_CENTS_PER_SEC,
          },
          margin: {
            revenueCents: revenueWindow,
            costCents: Math.round(blendedTotal),
            grossCents: revenueWindow - Math.round(blendedTotal),
            marginPct: revenueWindow > 0 ? (revenueWindow - blendedTotal) / revenueWindow : 0,
            // Blended realized price of a credit in this window, and what one
            // costs us to serve. The gap is the real unit economics.
            revenuePerCredit: creditsWindow > 0 ? revenueWindow / creditsWindow : 0,
            costPerCredit: creditsWindow > 0 ? blendedTotal / creditsWindow : 0,
          },
          moderation: {
            ...moderationStats,
            wasted_cost_total_cents: Math.round(Number(moderationStats.wasted_cost_total_cents)),
            wasted_cost_window_cents: Math.round(Number(moderationStats.wasted_cost_window_cents)),
            offenders: moderationOffenders,
          },
        });
      }

      // -- Revenue breakdown by pack/type/gateway --
      // Grants ($0) are reported on their own rather than mixed into the
      // revenue tables, where they used to show up as a top-selling "pack".
      case "revenue-breakdown": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);

        const byPack = (await sql.query(
          `SELECT package, type,
                  COUNT(*)::int AS count,
                  SUM(amount_cents)::int AS total_cents,
                  SUM(credits)::int AS total_credits,
                  ROUND(AVG(amount_cents))::int AS avg_cents,
                  CASE WHEN SUM(credits) > 0
                       THEN ROUND(SUM(amount_cents)::numeric / SUM(credits), 3)
                       ELSE NULL END AS cents_per_credit
           FROM transactions
           WHERE ${SQL_IS_REVENUE}
           GROUP BY package, type
           ORDER BY total_cents DESC`,
        )) as any[];

        const byPackWindow = (await sql.query(
          `SELECT package, type,
                  COUNT(*)::int AS count,
                  SUM(amount_cents)::int AS total_cents,
                  SUM(credits)::int AS total_credits,
                  ROUND(AVG(amount_cents))::int AS avg_cents,
                  CASE WHEN SUM(credits) > 0
                       THEN ROUND(SUM(amount_cents)::numeric / SUM(credits), 3)
                       ELSE NULL END AS cents_per_credit
           FROM transactions
           WHERE ${SQL_IS_REVENUE} AND ${win.sql}
           GROUP BY package, type
           ORDER BY total_cents DESC`,
          win.params,
        )) as any[];

        // Settlement rail, then the Stripe payment-method mix underneath it.
        const byGateway = (await sql.query(
          `SELECT ${SQL_GATEWAY} AS gateway,
                  COUNT(*)::int AS count,
                  SUM(amount_cents)::int AS total_cents,
                  COUNT(*) FILTER (WHERE ${win.sql})::int AS count_window,
                  COALESCE(SUM(amount_cents) FILTER (WHERE ${win.sql}), 0)::int AS window_cents
           FROM transactions
           WHERE ${SQL_IS_REVENUE}
           GROUP BY 1
           ORDER BY total_cents DESC`,
          win.params,
        )) as any[];

        const byMethod = (await sql.query(
          `SELECT COALESCE(payment_method, 'unknown') AS method,
                  COUNT(*)::int AS count,
                  SUM(amount_cents)::int AS total_cents,
                  COUNT(*) FILTER (WHERE ${win.sql})::int AS count_window,
                  COALESCE(SUM(amount_cents) FILTER (WHERE ${win.sql}), 0)::int AS window_cents
           FROM transactions
           WHERE ${SQL_IS_REVENUE}
           GROUP BY 1
           ORDER BY total_cents DESC`,
          win.params,
        )) as any[];

        const grants = (await sql.query(
          `SELECT package,
                  COUNT(*)::int AS count,
                  COALESCE(SUM(credits), 0)::int AS credits,
                  COUNT(*) FILTER (WHERE ${win.sql})::int AS count_window
           FROM transactions
           WHERE NOT (${SQL_IS_REVENUE})
           GROUP BY package
           ORDER BY count DESC`,
          win.params,
        )) as any[];

        return res.status(200).json({
          range: { days: range.days, bucket: range.bucket, label: range.label },
          byPack,
          byGateway,
          byMethod,
          grants,
          byPackWindow,
          // Kept so an un-refreshed client bundle doesn't render an empty table.
          byPack30d: byPackWindow,
        });
      }

      // -- Revenue time series, gap-filled, any range/granularity --
      case "revenue": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "t.created_at", 1);
        const rows = (await sql.query(
          `WITH ${bucketSeriesCte(range, "transactions")},
           agg AS (
             SELECT date_trunc('${range.bucket}', t.created_at)::date AS bucket,
                    COALESCE(SUM(t.amount_cents), 0)::int AS revenue_cents,
                    COUNT(*)::int AS tx_count,
                    COUNT(*) FILTER (WHERE t.type = 'pack')::int AS packs,
                    COUNT(*) FILTER (WHERE t.type = 'subscription')::int AS subs,
                    COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'pack'), 0)::int AS pack_cents,
                    COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'subscription'), 0)::int AS sub_cents,
                    COUNT(DISTINCT t.user_id)::int AS buyers
             FROM transactions t
             WHERE ${SQL_IS_REVENUE} AND ${win.sql}
             GROUP BY 1
           )
           SELECT b.bucket AS day,
                  COALESCE(a.revenue_cents, 0) AS revenue_cents,
                  COALESCE(a.tx_count, 0)      AS tx_count,
                  COALESCE(a.packs, 0)         AS packs,
                  COALESCE(a.subs, 0)          AS subs,
                  COALESCE(a.pack_cents, 0)    AS pack_cents,
                  COALESCE(a.sub_cents, 0)     AS sub_cents,
                  COALESCE(a.buyers, 0)        AS buyers,
                  SUM(COALESCE(a.revenue_cents, 0)) OVER (ORDER BY b.bucket)::int AS cumulative_cents
           FROM buckets b
           LEFT JOIN agg a ON a.bucket = b.bucket
           ORDER BY b.bucket`,
          win.params,
        )) as any[];
        return res.status(200).json({ revenue: rows, range: { days: range.days, bucket: range.bucket, label: range.label } });
      }

      // -- User growth time series --
      // `cumulative` is a true running total from day zero, not just the sum
      // inside the window, so a 7d view still shows the real user count.
      case "users": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);
        const rows = (await sql.query(
          `WITH ${bucketSeriesCte(range, "users")},
           agg AS (
             SELECT date_trunc('${range.bucket}', created_at)::date AS bucket,
                    COUNT(*)::int AS new_users,
                    COUNT(*) FILTER (WHERE email_verified)::int AS verified
             FROM users
             GROUP BY 1
           ),
           joined AS (
             SELECT b.bucket,
                    COALESCE(a.new_users, 0) AS new_users,
                    COALESCE(a.verified, 0)  AS verified
             FROM buckets b LEFT JOIN agg a ON a.bucket = b.bucket
           ),
           base AS (
             SELECT COALESCE(COUNT(*), 0)::int AS n
             FROM users
             WHERE created_at < (SELECT MIN(bucket) FROM buckets)
           )
           SELECT j.bucket AS day,
                  j.new_users,
                  j.verified,
                  ((SELECT n FROM base) + SUM(j.new_users) OVER (ORDER BY j.bucket))::int AS cumulative
           FROM joined j
           ORDER BY j.bucket`,
        )) as any[];
        return res.status(200).json({ users: rows, range: { days: range.days, bucket: range.bucket, label: range.label } });
      }

      // -- Generation volume by mode --
      // Modes are collapsed onto their base name, so `comfy-klein` and
      // `comfy-klein-refunded-support` stop showing up as two products.
      case "usage": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);
        const rows = (await sql.query(
          `SELECT date_trunc('${range.bucket}', created_at)::date AS day,
                  ${SQL_BASE_MODE} AS mode,
                  COUNT(*) FILTER (WHERE NOT (${SQL_IS_REFUND}))::int AS count,
                  COUNT(*) FILTER (WHERE ${SQL_IS_REFUND})::int AS refunded,
                  COALESCE(SUM(${SQL_NET_CREDITS}), 0)::int AS credits
           FROM usage_log
           WHERE ${win.sql} AND ${SQL_IS_JOB}
           GROUP BY 1, 2
           HAVING COUNT(*) > 0
           ORDER BY 1`,
          win.params,
        )) as any[];
        return res.status(200).json({ usage: rows, range: { days: range.days, bucket: range.bucket, label: range.label } });
      }

      // -- Transaction log --
      case "transactions": {
        const limit = Math.min(500, Math.max(1, parseInt(String(req.body?.limit ?? "100"), 10) || 100));
        const includeGrants = req.body?.includeGrants === true;
        const rows = (await sql.query(
          // payment_method / stripe_session_id / amount_cents exist only on
          // transactions, so the unqualified fragments resolve unambiguously
          // across the join.
          `SELECT t.created_at, u.email, t.type, t.package, t.credits, t.amount_cents,
                  t.payment_method, ${SQL_GATEWAY} AS gateway
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${includeGrants ? "" : `WHERE ${SQL_IS_REVENUE}`}
           ORDER BY t.created_at DESC
           LIMIT $1`,
          [limit],
        )) as any[];
        return res.status(200).json({ transactions: rows });
      }

      // -- Top users by credit usage, with what each one actually costs us --
      //
      // The old shape ran two LATERAL subqueries per row across all 28k users
      // and every one of the 422k usage rows, unwindowed. This aggregates each
      // side once, ranks, then joins only the survivors — and adds the number
      // that matters: spend minus serving cost, so a heavy-but-unprofitable
      // account is visible instead of just "heavy".
      case "top-users": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);
        const limit = Math.min(200, Math.max(1, parseInt(String(req.body?.limit ?? "25"), 10) || 25));
        const sortBy = req.body?.sortBy === "margin" ? "margin_cents ASC"
          : req.body?.sortBy === "spend" ? "spent_cents DESC"
          : "credits_used DESC";

        const rows = (await sql.query(
          `WITH ${costCtes(win.sql)},
           by_user AS (
             SELECT ul.user_id,
                    COUNT(*) FILTER (WHERE NOT (${SQL_IS_REFUND}))::int AS generations,
                    COALESCE(SUM(${SQL_NET_CREDITS}), 0)::int AS credits_used,
                    MAX(ul.created_at) AS last_generation
             FROM usage_log ul
             WHERE ${win.sql} AND ${SQL_IS_JOB}
             GROUP BY ul.user_id
           ),
           cost_by_user AS (
             SELECT user_id, SUM(blended_cents) AS cost_cents
             FROM priced
             GROUP BY user_id
           ),
           spend_by_user AS (
             SELECT user_id, SUM(amount_cents)::int AS spent_cents, COUNT(*)::int AS purchases
             FROM transactions
             WHERE ${SQL_IS_REVENUE} AND ${win.sql}
             GROUP BY user_id
           ),
           ranked AS (
             SELECT b.user_id, b.generations, b.credits_used, b.last_generation,
                    COALESCE(c.cost_cents, 0)::numeric AS cost_cents,
                    COALESCE(s.spent_cents, 0)::int    AS spent_cents,
                    COALESCE(s.purchases, 0)::int      AS purchases,
                    (COALESCE(s.spent_cents, 0) - COALESCE(c.cost_cents, 0))::numeric AS margin_cents
             FROM by_user b
             LEFT JOIN cost_by_user c ON c.user_id = b.user_id
             LEFT JOIN spend_by_user s ON s.user_id = b.user_id
           )
           SELECT u.email, u.subscription_tier, u.subscription_cancel_at,
                  u.sub_credits, u.pack_credits, u.created_at,
                  r.generations::int AS total_generations,
                  r.credits_used::int AS total_credits_used,
                  r.last_generation,
                  r.spent_cents AS total_spent_cents,
                  r.purchases,
                  ROUND(r.cost_cents)::int   AS cost_cents,
                  ROUND(r.margin_cents)::int AS margin_cents
           FROM ranked r
           JOIN users u ON u.id = r.user_id
           ORDER BY ${sortBy}
           LIMIT ${limit}`,
          win.params,
        )) as any[];
        return res.status(200).json({ topUsers: rows, range: { days: range.days, bucket: range.bucket, label: range.label } });
      }

      // -- Credit farmers: users whose balance far exceeds what they ever paid for --
      // Real purchases (Stripe packs/subs, XRGE) always write a transactions row with
      // amount_cents > 0; free rewards (spins, missions, daily, referral, follow/weekly
      // bonuses) bump pack_credits with no such row. So balance − purchased − admin-granted
      // = credits obtained for free. A large excess is the farming signature.
      case "credit-farmers": {
        const minExcess = Math.max(1, parseInt(req.body?.minExcess, 10) || 100);
        const farmLimit = Math.min(500, Math.max(1, parseInt(req.body?.limit, 10) || 100));
        const rows = await sql`
          WITH paid AS (
            SELECT user_id,
              COALESCE(SUM(credits) FILTER (WHERE amount_cents > 0), 0)::int AS purchased,
              COALESCE(SUM(credits) FILTER (WHERE COALESCE(amount_cents, 0) = 0 AND payment_method = 'admin'), 0)::int AS admin_granted,
              COALESCE(SUM(amount_cents), 0)::int AS paid_cents
            FROM transactions
            GROUP BY user_id
          ),
          spend AS (
            SELECT user_id, COALESCE(SUM(credits_used), 0)::int AS spent
            FROM usage_log
            GROUP BY user_id
          ),
          fp AS (
            SELECT device_fingerprint, COUNT(*)::int AS cnt
            FROM users
            WHERE device_fingerprint IS NOT NULL AND device_fingerprint <> ''
            GROUP BY device_fingerprint
          ),
          refs AS (
            SELECT referred_by AS user_id, COUNT(*)::int AS cnt
            FROM users WHERE referred_by IS NOT NULL
            GROUP BY referred_by
          )
          SELECT
            u.id, u.email, pr.username, u.created_at, u.subscription_tier,
            COALESCE(u.is_featured_creator, false) AS is_creator,
            (COALESCE(u.daily_credits,0) + COALESCE(u.sub_credits,0) + COALESCE(u.pack_credits,0))::int AS balance,
            COALESCE(p.purchased, 0) AS purchased,
            COALESCE(p.admin_granted, 0) AS admin_granted,
            COALESCE(p.paid_cents, 0) AS paid_cents,
            COALESCE(s.spent, 0) AS lifetime_spent,
            COALESCE(f.cnt, 1) AS fp_accounts,
            COALESCE(r.cnt, 0) AS referrals,
            (ub.user_id IS NOT NULL) AS banned,
            ((COALESCE(u.daily_credits,0) + COALESCE(u.sub_credits,0) + COALESCE(u.pack_credits,0))
              - COALESCE(p.purchased, 0) - COALESCE(p.admin_granted, 0))::int AS excess
          FROM users u
          LEFT JOIN paid p ON p.user_id = u.id
          LEFT JOIN spend s ON s.user_id = u.id
          LEFT JOIN fp f ON f.device_fingerprint = u.device_fingerprint
          LEFT JOIN refs r ON r.user_id = u.id
          LEFT JOIN profiles pr ON pr.user_id = u.id
          LEFT JOIN user_bans ub ON ub.user_id = u.id
          WHERE (COALESCE(u.daily_credits,0) + COALESCE(u.sub_credits,0) + COALESCE(u.pack_credits,0))
                - COALESCE(p.purchased, 0) - COALESCE(p.admin_granted, 0) >= ${minExcess}
          ORDER BY excess DESC
          LIMIT ${farmLimit}
        `;
        return res.status(200).json({ suspects: rows, minExcess });
      }

      // -- Per-suspect farming evidence drilldown --
      // Breaks a user's credit history into attributable sources (missions,
      // one-time claims, referrals, unlock income) and surfaces the multi-account
      // signals: fingerprint cluster, referees/unlockers sharing the device
      // fingerprint (self-referral / alt-funded unlock laundering).
      case "farmer-detail": {
        const targetUserId = req.body?.userId;
        if (!targetUserId) return res.status(400).json({ error: "userId required" });

        const [user] = await sql`
          SELECT u.id, u.email, u.created_at, u.email_verified, u.subscription_tier,
                 u.device_fingerprint, u.daily_credits, u.sub_credits, u.pack_credits,
                 COALESCE(u.cash_balance_cents, 0)::int AS cash_balance_cents,
                 u.last_free_spin, COALESCE(u.spin_streak, 0)::int AS spin_streak,
                 COALESCE(u.karma, 0)::int AS karma, u.referred_by,
                 pr.username
          FROM users u
          LEFT JOIN profiles pr ON pr.user_id = u.id
          WHERE u.id = ${targetUserId}::uuid
        `;
        if (!user) return res.status(404).json({ error: "User not found" });

        const purchases = await sql`
          SELECT credits, amount_cents, package, type, payment_method, created_at
          FROM transactions
          WHERE user_id = ${targetUserId}::uuid
          ORDER BY created_at DESC
          LIMIT 15
        `.catch(() => []);

        const [missions] = await sql`
          SELECT COALESCE(SUM(credits), 0)::int AS credits,
                 COUNT(*)::int AS claims,
                 COUNT(DISTINCT claim_date)::int AS days,
                 MIN(claim_date) AS first_day,
                 MAX(claim_date) AS last_day
          FROM daily_mission_claims
          WHERE user_id = ${targetUserId}::uuid
        `.catch(() => [{ credits: 0, claims: 0, days: 0, first_day: null, last_day: null }]);

        const oneTimeClaims = await sql`
          SELECT claim_key, credits, created_at
          FROM one_time_claims
          WHERE user_id = ${targetUserId}::uuid
          ORDER BY created_at DESC
        `.catch(() => []);

        // Who they referred — and whether any referee shares their fingerprint.
        const referees = await sql`
          SELECT r.created_at, r.referee_verified, r.referee_purchased, r.referrer_rewarded,
                 u.email, pr.username,
                 (u.device_fingerprint IS NOT NULL AND u.device_fingerprint = (
                   SELECT device_fingerprint FROM users WHERE id = ${targetUserId}::uuid
                 )) AS same_fp
          FROM referrals r
          JOIN users u ON u.id = r.referee_id
          LEFT JOIN profiles pr ON pr.user_id = r.referee_id
          WHERE r.referrer_id = ${targetUserId}::uuid
          ORDER BY r.created_at DESC
          LIMIT 50
        `.catch(() => []);

        // Unlock income on their posts/stories, with the paying accounts —
        // alt accounts funneling free credits to a main show up here.
        const feedUnlockers = await sql`
          SELECT fu.user_id, u.email, pr.username,
                 COUNT(*)::int AS unlocks,
                 COALESCE(SUM(fu.credits_paid), 0)::int AS credits_paid,
                 (u.device_fingerprint IS NOT NULL AND u.device_fingerprint = (
                   SELECT device_fingerprint FROM users WHERE id = ${targetUserId}::uuid
                 )) AS same_fp
          FROM feed_unlocks fu
          JOIN feed_posts p ON p.id = fu.post_id
          JOIN users u ON u.id = fu.user_id
          LEFT JOIN profiles pr ON pr.user_id = fu.user_id
          WHERE p.user_id = ${targetUserId}::uuid AND fu.unlock_method = 'credits'
          GROUP BY fu.user_id, u.email, pr.username, u.device_fingerprint
          ORDER BY credits_paid DESC
          LIMIT 20
        `.catch(() => []);

        const storyUnlockers = await sql`
          SELECT su.user_id, u.email, pr.username,
                 COUNT(*)::int AS unlocks,
                 COALESCE(SUM(su.credits_paid), 0)::int AS credits_paid,
                 (u.device_fingerprint IS NOT NULL AND u.device_fingerprint = (
                   SELECT device_fingerprint FROM users WHERE id = ${targetUserId}::uuid
                 )) AS same_fp
          FROM story_unlocks su
          JOIN stories s ON s.id = su.story_id
          JOIN users u ON u.id = su.user_id
          LEFT JOIN profiles pr ON pr.user_id = su.user_id
          WHERE s.user_id = ${targetUserId}::uuid
          GROUP BY su.user_id, u.email, pr.username, u.device_fingerprint
          ORDER BY credits_paid DESC
          LIMIT 20
        `.catch(() => []);

        const [activity] = await sql`
          SELECT COUNT(*)::int AS generations,
                 COALESCE(SUM(credits_used), 0)::int AS spent,
                 COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS generations_7d,
                 COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '7 days'), 0)::int AS spent_7d,
                 COALESCE(SUM(credits_used) FILTER (WHERE mode LIKE '%-refunded'), 0)::int AS refunded,
                 MIN(created_at) AS first_gen,
                 MAX(created_at) AS last_gen
          FROM usage_log
          WHERE user_id = ${targetUserId}::uuid
        `.catch(() => [{ generations: 0, spent: 0, generations_7d: 0, spent_7d: 0, refunded: 0, first_gen: null, last_gen: null }]);

        // Every account on the same device fingerprint.
        const fpCluster = user.device_fingerprint
          ? await sql`
              SELECT u.id, u.email, pr.username, u.created_at,
                     (COALESCE(u.daily_credits,0) + COALESCE(u.sub_credits,0) + COALESCE(u.pack_credits,0))::int AS balance,
                     (ub.user_id IS NOT NULL) AS banned
              FROM users u
              LEFT JOIN profiles pr ON pr.user_id = u.id
              LEFT JOIN user_bans ub ON ub.user_id = u.id
              WHERE u.device_fingerprint = ${user.device_fingerprint} AND u.id <> ${targetUserId}::uuid
              ORDER BY u.created_at ASC
              LIMIT 20
            `.catch(() => [])
          : [];

        // Who referred THEM (self-referral rings run both directions).
        const [referrer] = user.referred_by
          ? await sql`
              SELECT u.email, pr.username,
                     (u.device_fingerprint IS NOT NULL AND u.device_fingerprint = ${user.device_fingerprint || null}) AS same_fp
              FROM users u
              LEFT JOIN profiles pr ON pr.user_id = u.id
              WHERE u.id = ${user.referred_by}::uuid
            `.catch(() => [null])
          : [null];

        return res.status(200).json({
          user,
          purchases,
          missions,
          oneTimeClaims,
          referees,
          feedUnlockers,
          storyUnlockers,
          activity,
          fpCluster,
          referrer: referrer || null,
        });
      }

      // -- Referral stats --
      case "referrals": {
        const [stats] = await sql`
          SELECT
            COUNT(*)::int AS total_referrals,
            COUNT(*) FILTER (WHERE referee_verified)::int AS verified,
            COUNT(*) FILTER (WHERE referee_purchased)::int AS converted,
            COUNT(*) FILTER (WHERE referrer_rewarded)::int AS rewarded,
            COALESCE(COUNT(*) FILTER (WHERE referee_purchased), 0)::int AS purchases
          FROM referrals
        `;
        const conversionRate = stats.total_referrals > 0
          ? Math.round((stats.converted / stats.total_referrals) * 100)
          : 0;
        // Credits granted: 3 per verified signup + 10 per rewarded referrer + 5 per purchase bonus
        const creditsGranted = (stats.verified * 3) + (stats.rewarded * 10) + (stats.purchases * 5);

        // Real dollars from referred users (all their purchases, lifetime).
        const [attributed] = await sql`
          SELECT COALESCE(SUM(t.amount_cents), 0)::int AS revenue_cents,
                 COUNT(DISTINCT t.user_id)::int AS paying_referees
          FROM transactions t
          JOIN referrals r ON r.referee_id = t.user_id
          WHERE t.amount_cents > 0
        `;

        // Top referrers, ranked by the revenue their referees brought in.
        const topReferrers = await sql`
          SELECT
            u.email,
            COUNT(*)::int AS referral_count,
            COUNT(*) FILTER (WHERE r.referee_purchased)::int AS conversions,
            COUNT(*) FILTER (WHERE r.referrer_rewarded)::int AS rewards,
            COALESCE((
              SELECT SUM(t.amount_cents) FROM transactions t
              WHERE t.amount_cents > 0
                AND t.user_id IN (SELECT referee_id FROM referrals r2 WHERE r2.referrer_id = r.referrer_id)
            ), 0)::int AS revenue_cents
          FROM referrals r
          JOIN users u ON u.id = r.referrer_id
          GROUP BY r.referrer_id, u.email
          ORDER BY revenue_cents DESC, referral_count DESC
          LIMIT 10
        `;

        // Latest referred signups with what each has spent so far.
        const recentSignups = await sql`
          SELECT r.created_at, r.referee_verified, r.referee_purchased,
                 ru.email AS referee_email, rr.email AS referrer_email,
                 COALESCE((
                   SELECT SUM(t.amount_cents) FROM transactions t
                   WHERE t.user_id = r.referee_id AND t.amount_cents > 0
                 ), 0)::int AS spend_cents
          FROM referrals r
          JOIN users ru ON ru.id = r.referee_id
          JOIN users rr ON rr.id = r.referrer_id
          ORDER BY r.created_at DESC
          LIMIT 25
        `;

        return res.status(200).json({
          referrals: {
            ...stats,
            conversionRate,
            creditsGranted,
            attributedRevenueCents: attributed.revenue_cents,
            payingReferees: attributed.paying_referees,
            topReferrers,
            recentSignups,
          },
        });
      }

      // -- Per-mode unit economics --
      //
      // One row per product (base mode), carrying: how often it ran, what it
      // cost, how much of that cost is measured vs inferred, and what it earns
      // at the window's own realized credit price. `revenue_cents` is an
      // attribution, not a booking — credits are sold in packs, so the honest
      // way to value a generation is the blended ¢/credit actually realized in
      // the same window.
      case "profit-breakdown":
      case "unit-economics": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);

        const [priceRow] = (await sql.query(
          `SELECT COALESCE(SUM(amount_cents), 0)::int AS revenue_cents
           FROM transactions WHERE ${SQL_IS_REVENUE} AND ${win.sql}`,
          win.params,
        )) as any[];

        const rows = (await sql.query(
          `WITH ${costCtes(win.sql)}
           SELECT
             base_mode AS mode,
             MAX(provider) AS provider,
             COUNT(*) FILTER (WHERE NOT is_refund)::int      AS generations,
             COUNT(*) FILTER (WHERE is_refund)::int          AS refunded,
             COALESCE(SUM(net_credits), 0)::int              AS credits_used,
             COALESCE(SUM(credits_used) FILTER (WHERE is_refund), 0)::int AS refunded_credits,
             COALESCE(SUM(execution_time_ms), 0)::bigint     AS total_exec_ms,
             COUNT(execution_time_ms) FILTER (WHERE execution_time_ms > 0)::int AS exec_tracked,
             COALESCE(SUM(api_cost_cents), 0)::numeric       AS actual_cost_cents,
             COUNT(api_cost_cents)::int                      AS cost_tracked_count,
             COALESCE(SUM(blended_cents), 0)::numeric        AS blended_cost_cents,
             COUNT(*)::int                                   AS rows_total
           FROM priced
           GROUP BY base_mode
           ORDER BY blended_cost_cents DESC`,
          win.params,
        )) as any[];

        const totalCredits = rows.reduce((a, r) => a + Number(r.credits_used || 0), 0);
        const centsPerCredit = totalCredits > 0 ? priceRow.revenue_cents / totalCredits : 0;

        const breakdown = rows.map((r) => {
          const credits = Number(r.credits_used);
          const cost = Number(r.blended_cost_cents);
          const revenue = credits * centsPerCredit;
          const gens = Number(r.generations);
          return {
            mode: r.mode,
            provider: r.provider,
            generations: gens,
            refunded: Number(r.refunded),
            credits_used: credits,
            refunded_credits: Number(r.refunded_credits),
            total_exec_ms: Number(r.total_exec_ms),
            exec_tracked: Number(r.exec_tracked),
            actual_cost_cents: Number(r.actual_cost_cents),
            cost_tracked_count: Number(r.cost_tracked_count),
            blended_cost_cents: cost,
            // Share of this mode's cost that is measured rather than inferred.
            cost_coverage: Number(r.rows_total) > 0 ? Number(r.cost_tracked_count) / Number(r.rows_total) : 0,
            cost_per_generation: gens > 0 ? cost / gens : 0,
            cost_per_credit: credits > 0 ? cost / credits : 0,
            revenue_cents: revenue,
            margin_cents: revenue - cost,
            margin_pct: revenue > 0 ? (revenue - cost) / revenue : 0,
            avg_exec_sec: Number(r.exec_tracked) > 0 ? Number(r.total_exec_ms) / Number(r.exec_tracked) / 1000 : 0,
          };
        });

        return res.status(200).json({
          profitBreakdown: breakdown,
          unitEconomics: breakdown,
          centsPerCredit,
          windowRevenueCents: priceRow.revenue_cents,
          range: { days: range.days, bucket: range.bucket, label: range.label },
        });
      }

      // -- Stripe ground truth + reconciliation against our own ledger --
      //
      // `transactions` only records money coming in, and only when a webhook
      // lands. Stripe's balance-transaction ledger is the same source its own
      // dashboard reports from and is the only one carrying fees, refunds and
      // chargebacks — so this is the action that answers "what did we actually
      // make", as opposed to "what did we book".
      case "finance": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);
        if (req.body?.refresh === true) clearStripeCache();

        const [stripeWindow, mrr, balance] = await Promise.all([
          getStripeWindow(range.days, range.bucket).catch((e) => {
            console.error("[admin finance] stripe window failed", e?.message);
            return null;
          }),
          getStripeMrr().catch((e) => {
            console.error("[admin finance] stripe mrr failed", e?.message);
            return null;
          }),
          getStripeBalance().catch(() => null),
        ]);

        // Our own booked total for the same window, Stripe rail only, so the
        // two sides are comparable (XRGE and grants never touch Stripe).
        const [booked] = (await sql.query(
          `SELECT COALESCE(SUM(amount_cents), 0)::int AS booked_cents,
                  COUNT(*)::int AS booked_count
           FROM transactions
           WHERE ${SQL_IS_REVENUE} AND ${win.sql}
             AND stripe_session_id IS NOT NULL
             AND COALESCE(payment_method, '') <> 'admin'`,
          win.params,
        )) as any[];

        const [allRails] = (await sql.query(
          `SELECT COALESCE(SUM(amount_cents), 0)::int AS cents,
                  COUNT(*)::int AS count
           FROM transactions WHERE ${SQL_IS_REVENUE} AND ${win.sql}`,
          win.params,
        )) as any[];

        // Cost for the same window, so margin is computed off net revenue
        // rather than gross bookings.
        const [cost] = (await sql.query(
          `WITH ${costCtes(win.sql)}
           SELECT COALESCE(SUM(blended_cents), 0)::numeric AS cost_cents,
                  COUNT(*)::int AS jobs,
                  COUNT(api_cost_cents)::int AS tracked
           FROM priced`,
          win.params,
        )) as any[];

        const costCents = Math.round(Number(cost.cost_cents));
        const netCents = stripeWindow?.netCents ?? null;
        // Reconcile against PLATFORM gross. The Stripe account also carries
        // event-ticket charges that no webhook branch handles, so including
        // them would report a permanent drift for revenue that was never ours.
        const grossCents = stripeWindow?.platformGrossCents ?? null;

        // Reconciliation: a gap means Stripe collected money that never
        // reached our ledger. Two known structural causes, both real:
        //   • creator-verification checkouts only flip flags on `users`
        //     (webhook.ts:638) and never write a transactions row at all;
        //   • subscription renewals went unrecorded for all of April and May
        //     2026 — 0 rows against 100/101 in the preceding months.
        // The per-bucket series is what makes the second kind visible.
        const drift =
          grossCents !== null ? grossCents - booked.booked_cents : null;

        const ledgerSeries = (await sql.query(
          `SELECT to_char(date_trunc('${range.bucket}', created_at), 'YYYY-MM-DD') AS day,
                  COALESCE(SUM(amount_cents), 0)::int AS booked,
                  COUNT(*)::int AS booked_count
           FROM transactions
           WHERE ${SQL_IS_REVENUE} AND ${win.sql}
             AND stripe_session_id IS NOT NULL
             AND COALESCE(payment_method, '') <> 'admin'
           GROUP BY 1 ORDER BY 1`,
          win.params,
        )) as any[];

        const ledgerBy = new Map(ledgerSeries.map((r: any) => [r.day, r]));
        const comparison = (stripeWindow?.series ?? []).map((s) => {
          const l: any = ledgerBy.get(s.day);
          const booked = l ? Number(l.booked) : 0;
          return {
            day: s.day,
            stripeGross: s.gross,
            stripeFee: s.fee,
            stripeNet: s.net,
            ledgerBooked: booked,
            driftCents: s.gross - booked,
          };
        });

        return res.status(200).json({
          range: { days: range.days, bucket: range.bucket, label: range.label },
          stripe: stripeWindow,
          mrr,
          balance,
          booked: {
            stripeRailCents: booked.booked_cents,
            stripeRailCount: booked.booked_count,
            allRailsCents: allRails.cents,
            allRailsCount: allRails.count,
          },
          reconciliation: drift === null ? null : {
            stripeGrossCents: grossCents,
            ledgerCents: booked.booked_cents,
            driftCents: drift,
            driftPct: booked.booked_cents > 0 ? drift / booked.booked_cents : 0,
            stripeCount: stripeWindow?.chargeCount ?? 0,
            ledgerCount: booked.booked_count,
            comparison,
          },
          cost: {
            cents: costCents,
            jobs: cost.jobs,
            trackedRows: cost.tracked,
            coverage: cost.jobs > 0 ? cost.tracked / cost.jobs : 0,
          },
          margin: netCents === null ? null : {
            netRevenueCents: netCents,
            costCents,
            profitCents: netCents - costCents,
            marginPct: netCents > 0 ? (netCents - costCents) / netCents : 0,
          },
        });
      }

      // -- RunPod: what we think we spent vs what RunPod says --
      //
      // `api_cost_cents` is execution time × one flat rate (comfyui.ts:3181),
      // which is the H200 flex price applied to every endpoint — including
      // jobs that landed on the cheaper ADA workers in the same GPU list. It
      // also cannot see idle time, cold starts, or the seconds erased when a
      // job is refunded. The balance snapshots are the correction: real
      // drawdown per day, straight from the account.
      case "runpod-truth": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);

        const [estimate] = (await sql.query(
          `WITH ${costCtes(win.sql)}
           SELECT
             COUNT(*)::int                                AS jobs,
             COUNT(*) FILTER (WHERE is_refund)::int       AS refunded_jobs,
             COALESCE(SUM(execution_time_ms), 0)::bigint  AS exec_ms,
             COALESCE(SUM(api_cost_cents), 0)::numeric    AS tracked_cents,
             COUNT(api_cost_cents)::int                   AS tracked_rows,
             COALESCE(SUM(blended_cents), 0)::numeric     AS blended_cents
           FROM priced WHERE provider = 'runpod'`,
          win.params,
        )) as any[];

        const perMode = (await sql.query(
          `WITH ${costCtes(win.sql)}
           SELECT base_mode AS mode,
                  COUNT(*)::int AS jobs,
                  COALESCE(SUM(blended_cents), 0)::numeric AS cents,
                  COALESCE(AVG(NULLIF(execution_time_ms, 0)), 0)::numeric AS avg_ms
           FROM priced WHERE provider = 'runpod'
           GROUP BY base_mode ORDER BY cents DESC`,
          win.params,
        )) as any[];

        // Real drawdown, if the snapshot cron has been running. Deposits show
        // up as a balance increase, so only negative deltas are spend.
        let snapshots: any[] = [];
        let actualSpendCents: number | null = null;
        const snapWin = rangeClause(range, "captured_at", 1);
        try {
          snapshots = (await sql.query(
            `WITH s AS (
               SELECT captured_at, balance_usd,
                      LAG(balance_usd) OVER (ORDER BY captured_at) AS prev
               FROM runpod_balance_snapshots
               WHERE ${snapWin.sql}
             )
             SELECT captured_at, balance_usd,
                    CASE WHEN prev IS NOT NULL AND balance_usd < prev
                         THEN (prev - balance_usd) ELSE 0 END AS spend_usd
             FROM s ORDER BY captured_at`,
            snapWin.params,
          )) as any[];
          if (snapshots.length > 1) {
            actualSpendCents = Math.round(
              snapshots.reduce((a, r) => a + Number(r.spend_usd || 0), 0) * 100,
            );
          }
        } catch {
          // Table arrives with migration 054; before that we only have the estimate.
        }

        const live = isRunpodBalanceConfigured() ? await getRunpodBalance().catch(() => null) : null;
        const blended = Math.round(Number(estimate.blended_cents));

        return res.status(200).json({
          range: { days: range.days, bucket: range.bucket, label: range.label },
          estimate: {
            jobs: estimate.jobs,
            refundedJobs: estimate.refunded_jobs,
            execMs: Number(estimate.exec_ms),
            trackedCents: Math.round(Number(estimate.tracked_cents)),
            trackedRows: estimate.tracked_rows,
            blendedCents: blended,
            coverage: estimate.jobs > 0 ? estimate.tracked_rows / estimate.jobs : 0,
            centsPerSec: RUNPOD_CENTS_PER_SEC,
          },
          perMode: perMode.map((r: any) => ({
            mode: r.mode,
            jobs: r.jobs,
            cents: Math.round(Number(r.cents)),
            avgSec: Number(r.avg_ms) / 1000,
          })),
          live,
          snapshots,
          actual: actualSpendCents === null ? null : {
            spendCents: actualSpendCents,
            // >1 means real spend exceeds what per-job execution time explains:
            // idle workers, cold starts, and refunded jobs whose seconds were
            // zeroed out of the log.
            ratio: blended > 0 ? actualSpendCents / blended : null,
            unexplainedCents: actualSpendCents - blended,
            samples: snapshots.length,
          },
        });
      }

      // -- Media purge audit log (account deletes, library trash, admin sweeps) --
      case "purge-log": {
        const limit = Math.min(Math.max(parseInt(String(req.body?.limit || "100"), 10) || 100, 1), 500);
        const kindFilter = typeof req.body?.kind === "string" ? req.body.kind : null;
        try {
          await sql`
            CREATE TABLE IF NOT EXISTS purge_log (
              id BIGSERIAL PRIMARY KEY,
              run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              kind TEXT NOT NULL,
              actor_user_id UUID, actor_email TEXT,
              target_user_id UUID, target_email TEXT,
              blobs_found INT NOT NULL DEFAULT 0, blobs_deleted INT NOT NULL DEFAULT 0,
              r2_found INT NOT NULL DEFAULT 0, r2_deleted INT NOT NULL DEFAULT 0,
              errors INT NOT NULL DEFAULT 0, notes JSONB
            )
          `.catch(() => {});

          const rows = kindFilter
            ? await sql`
                SELECT * FROM purge_log
                WHERE kind = ${kindFilter}
                ORDER BY run_at DESC LIMIT ${limit}
              `
            : await sql`SELECT * FROM purge_log ORDER BY run_at DESC LIMIT ${limit}`;

          const totals = await sql`
            SELECT
              kind,
              COUNT(*)::int                       AS runs,
              COALESCE(SUM(blobs_found), 0)::int  AS blobs_found,
              COALESCE(SUM(blobs_deleted), 0)::int AS blobs_deleted,
              COALESCE(SUM(r2_found), 0)::int     AS r2_found,
              COALESCE(SUM(r2_deleted), 0)::int   AS r2_deleted,
              COALESCE(SUM(errors), 0)::int       AS errors,
              MAX(run_at)                         AS last_run_at
            FROM purge_log
            WHERE run_at > now() - interval '30 days'
            GROUP BY kind
            ORDER BY last_run_at DESC
          `;

          return res.status(200).json({ rows, totals });
        } catch (err: any) {
          console.error("[admin purge-log]", err.message);
          return res.status(500).json({ error: "Failed to load purge log" });
        }
      }


      case "sync-subscriptions": {
        const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
        if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });
        const stripe = new Stripe(STRIPE_SECRET_KEY);

        const activeSubUsers = await sql`
          SELECT id, email, stripe_customer_id, subscription_tier, subscription_cancel_at
          FROM users
          WHERE subscription_tier IS NOT NULL AND stripe_customer_id IS NOT NULL
        `;

        let synced = 0;
        let marked_cancelling = 0;
        let cleared = 0;
        let already_deleted = 0;
        let duplicates = 0;
        const details: any[] = [];

        for (const user of activeSubUsers) {
          try {
            const subs = await stripe.subscriptions.list({
              customer: user.stripe_customer_id,
              status: "all",
              limit: 5,
            });

            const activeSub = subs.data.find(
              (s) => s.metadata?.user_id === user.id && (s.status === "active" || s.status === "trialing")
            ) || subs.data.find(
              (s) => s.status === "active" || s.status === "trialing"
            );

            const debugInfo = {
              email: user.email,
              subs_found: subs.data.length,
              statuses: subs.data.map((s) => ({
                id: s.id,
                status: s.status,
                cancel_at_period_end: s.cancel_at_period_end,
                cancel_at: s.cancel_at,
                current_period_end: (s as any).current_period_end,
                meta_user_id: s.metadata?.user_id,
              })),
            };

            if (!activeSub) {
              await sql`SELECT clear_subscription(${user.id}::uuid)`;
              already_deleted++;
              details.push({ ...debugInfo, action: "cleared (no active sub in Stripe)" });
            } else {
              const isCancelling = activeSub.cancel_at_period_end || !!activeSub.cancel_at;
              const cancelTimestamp = activeSub.cancel_at
                ? new Date(activeSub.cancel_at * 1000).toISOString()
                : activeSub.cancel_at_period_end
                  ? new Date((activeSub as any).current_period_end * 1000).toISOString()
                  : null;

              if (isCancelling && !user.subscription_cancel_at) {
                await sql`
                  UPDATE users
                  SET subscription_cancel_at = ${cancelTimestamp}::timestamptz, updated_at = now()
                  WHERE id = ${user.id}::uuid
                `;
                marked_cancelling++;
                details.push({ ...debugInfo, action: "marked cancelling", cancel_at: cancelTimestamp });
              } else if (!isCancelling && user.subscription_cancel_at) {
                await sql`
                  UPDATE users
                  SET subscription_cancel_at = NULL, updated_at = now()
                  WHERE id = ${user.id}::uuid
                `;
                cleared++;
                details.push({ ...debugInfo, action: "cleared cancel_at (reactivated)" });
              } else {
                details.push({ ...debugInfo, action: "no change" });
              }

              const activeSubs = subs.data.filter(
                (s) => s.status === "active" || s.status === "trialing"
              );
              if (activeSubs.length > 1) {
                duplicates++;
                details[details.length - 1].warning = `DUPLICATE: ${activeSubs.length} active subs`;
              }
            }
            synced++;
          } catch (err: any) {
            details.push({ email: user.email, action: "error", error: "Sync failed" });
          }
        }

        return res.status(200).json({
          total_checked: activeSubUsers.length,
          synced,
          marked_cancelling,
          cleared,
          already_deleted,
          duplicates,
          details,
        });
      }

      // -- Grant credits to a user by email --
      case "grant-credits": {
        const { email, credits, type = "pack" } = req.body;
        if (!email || typeof email !== "string")
          return res.status(400).json({ error: "email is required" });
        const amount = parseInt(credits, 10);
        if (!amount || amount < 1 || amount > 50000)
          return res.status(400).json({ error: "credits must be 1–50000" });

        const [user] = await sql`SELECT id, email, sub_credits, pack_credits FROM users WHERE email = ${email.trim().toLowerCase()}`;
        if (!user)
          return res.status(404).json({ error: `User not found: ${email}` });

        if (type === "sub") {
          await sql`UPDATE users SET sub_credits = sub_credits + ${amount}, updated_at = now() WHERE id = ${user.id}`;
        } else {
          await sql`SELECT add_pack_credits(${user.id}::uuid, ${amount})`;
        }

        await sql`
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
          VALUES (${user.id}::uuid, ${amount}, 0, ${'admin-grant-' + Date.now()}, 'admin-grant', ${type === "sub" ? "subscription" : "pack"}, 'admin')
        `.catch(() => {});
        await logCreditGrant(sql, user.id, amount, "admin_grant", `by:${ADMIN_EMAIL} type:${type}`);

        const [updated] = await sql`SELECT sub_credits, pack_credits FROM users WHERE id = ${user.id}`;
        console.log(`[admin] Granted ${amount} ${type} credits to ${email} (sub=${updated.sub_credits}, pack=${updated.pack_credits})`);

        return res.status(200).json({
          granted: amount,
          type,
          email: user.email,
          sub_credits: updated.sub_credits,
          pack_credits: updated.pack_credits,
        });
      }

      // -- Purge ALL of a user's cloud-stored media (privacy request) --
      // Sweeps every user-scoped storage prefix on R2 + Vercel Blob. Their
      // library items that referenced remote copies will stop loading on
      // other devices — intended: this is the "make my uploads gone" tool.
      // Does NOT touch share links (user-revocable via SHARE_LINKS) or feed/
      // story posts (deletable in-app); pass includeShares=true to add shares.
      case "purge-user-storage": {
        const { email, includeShares = false } = req.body;
        if (!email || typeof email !== "string")
          return res.status(400).json({ error: "email is required" });
        const [user] = await sql`SELECT id, email FROM users WHERE email = ${email.trim().toLowerCase()}`;
        if (!user) return res.status(404).json({ error: `User not found: ${email}` });

        const { deleteR2Prefix } = await import("./_lib/r2");
        const folders = ["comfyui-output", "feed", "stories", "avatars", "prompts", "creator-applications", "uploads"];
        const r2Prefixes = [
          ...folders.map((f) => `${f}/${user.id}/`),
          `gltch/${user.id}-`,
          `seedance/${user.id}-`,
        ];
        if (includeShares) {
          const shares = await sql`SELECT share_id FROM share_owners WHERE user_id = ${user.id}`;
          for (const row of shares as any[]) {
            // dot-terminated: "shares/<id>." matches <id>.json/<id>.png but can
            // never match a longer share id that starts with this one
            if (/^[a-zA-Z0-9_-]{4,16}$/.test(row.share_id)) r2Prefixes.push(`shares/${row.share_id}.`);
          }
        }

        const breakdown: Record<string, number> = {};
        for (const p of r2Prefixes) {
          breakdown[p] = await deleteR2Prefix(p).catch(() => 0);
        }

        // Vercel Blob side (same user-scoped key conventions)
        let blobDeleted = 0;
        const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN || "";
        if (blobToken) {
          try {
            const { list, del } = await import("@vercel/blob");
            for (const p of r2Prefixes) {
              const { blobs } = await list({ prefix: p, token: blobToken });
              await Promise.all(blobs.map((b) =>
                del(b.url, { token: blobToken }).then(() => { blobDeleted++; }).catch(() => {})
              ));
            }
          } catch (e: any) {
            console.warn("[admin] purge-user-storage blob sweep:", e?.message);
          }
        }

        if (includeShares) {
          await sql`DELETE FROM share_owners WHERE user_id = ${user.id}`;
        }

        const r2Deleted = Object.values(breakdown).reduce((a, b) => a + b, 0);
        console.log(`[admin] purge-user-storage ${user.email}: r2=${r2Deleted} blob=${blobDeleted}`, JSON.stringify(breakdown));
        try {
          const { recordPurge } = await import("./_lib/purgeLog");
          const actor = getUserFromRequest(req);
          await recordPurge({
            kind: "admin-user-storage",
            actorUserId: actor?.userId,
            actorEmail: actor?.email,
            targetUserId: user.id,
            targetEmail: user.email,
            blobsFound: blobDeleted,
            blobsDeleted: blobDeleted,
            r2Found: r2Deleted,
            r2Deleted,
            errors: 0,
            notes: { includeShares, breakdown },
          });
        } catch { /* audit is best-effort */ }

        return res.status(200).json({ email: user.email, r2Deleted, blobDeleted, breakdown });
      }

      case "zero-credits": {
        const { email, userId: targetUserId } = req.body;
        if (!email && !targetUserId)
          return res.status(400).json({ error: "email or userId is required" });

        const [user] = email
          ? await sql`SELECT id, email, sub_credits, pack_credits, daily_credits FROM users WHERE email = ${String(email).trim().toLowerCase()}`
          : await sql`SELECT id, email, sub_credits, pack_credits, daily_credits FROM users WHERE id = ${targetUserId}::uuid`;
        if (!user)
          return res.status(404).json({ error: "User not found" });

        await sql`
          UPDATE users
          SET sub_credits = 0, pack_credits = 0, daily_credits = 0, updated_at = now()
          WHERE id = ${user.id}
        `;

        const wiped = (user.sub_credits || 0) + (user.pack_credits || 0) + (user.daily_credits || 0);
        await logCreditGrant(sql, user.id, -wiped, "admin_zero", `by:${ADMIN_EMAIL}`);
        console.log(`[admin] Zeroed credits for ${user.email} (was sub=${user.sub_credits}, pack=${user.pack_credits}, daily=${user.daily_credits})`);

        return res.status(200).json({
          email: user.email,
          wiped,
          previous: {
            sub_credits: user.sub_credits,
            pack_credits: user.pack_credits,
            daily_credits: user.daily_credits,
          },
        });
      }

      // -- Grant the SAME credit amount to every (verified) user in one go --
      case "grant-all-credits": {
        const { credits, type = "pack", verifiedOnly = true } = req.body;
        const amount = parseInt(credits, 10);
        if (!amount || amount < 1 || amount > 1000)
          return res.status(400).json({ error: "credits must be 1–1000 for bulk grant" });

        const users = verifiedOnly
          ? await sql`SELECT id, email FROM users WHERE email_verified = true`
          : await sql`SELECT id, email FROM users`;

        const tag = `admin-bulk-${Date.now()}`;
        let granted = 0;
        for (const u of users as any[]) {
          try {
            if (type === "sub") {
              await sql`UPDATE users SET sub_credits = sub_credits + ${amount}, updated_at = now() WHERE id = ${u.id}`;
            } else {
              await sql`SELECT add_pack_credits(${u.id}::uuid, ${amount})`;
            }
            await sql`
              INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
              VALUES (${u.id}::uuid, ${amount}, 0, ${tag + '-' + u.id}, 'admin-bulk-grant', ${type === "sub" ? "subscription" : "pack"}, 'admin')
            `.catch(() => {});
            await logCreditGrant(sql, u.id, amount, "admin_bulk_grant", tag).catch(() => {});
            granted++;
          } catch (e) {
            console.warn(`[admin] bulk grant failed for ${u.email}:`, e);
          }
        }
        console.log(`[admin] Bulk-granted ${amount} ${type} credits to ${granted}/${users.length} users (tag=${tag})`);
        return res.status(200).json({ recipients: granted, totalUsers: users.length, amount, type, tag });
      }

      // -- Email delivery logs --
      case "email-logs": {
        const { limit = 50, email_type, status: logStatus } = req.body;
        const rows = await sql`
          SELECT id, recipient, email_type, resend_id, status, error_message, created_at
          FROM email_log
          WHERE (${email_type ?? null}::text IS NULL OR email_type = ${email_type ?? null})
            AND (${logStatus ?? null}::text IS NULL OR status = ${logStatus ?? null})
          ORDER BY created_at DESC
          LIMIT ${Math.min(Number(limit) || 50, 200)}
        `;

        const [stats] = await sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last_24h,
            COUNT(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours')::int AS failed_24h
          FROM email_log
        `;

        return res.status(200).json({ logs: rows, stats });
      }

      // Delete failed/bounced/complained email_log entries so the
      // dedup filter in send-announcement no longer skips those recipients.
      // Modes:
      //   { ids: string[] }                      → delete specific log rows
      //   { campaign: string, scope: 'failed' }  → delete all non-'sent' rows for a campaign
      //   { recipient: string }                  → delete all failed rows for one recipient
      // 'sent' rows are NEVER deletable here — that would let the same user
      // receive the same campaign twice. To intentionally re-send, use a new
      // campaign name instead.
      case "delete-failed-emails": {
        const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : null;
        const campaign = typeof req.body.campaign === "string" ? req.body.campaign : null;
        const recipient = typeof req.body.recipient === "string" ? req.body.recipient : null;
        const scope = (req.body.scope as string) || "failed"; // 'failed' | 'all-non-sent'

        // Whitelist of statuses we're willing to delete. 'sent' is excluded
        // on purpose — see comment above.
        const deletableStatuses =
          scope === "all-non-sent"
            ? ["failed", "bounced", "complained", "delayed", "pending"]
            : ["failed", "bounced", "complained"];

        try {
          let deleted: any[] = [];
          if (ids && ids.length > 0) {
            deleted = await sql`
              DELETE FROM email_log
              WHERE id = ANY(${ids}::uuid[])
                AND status = ANY(${deletableStatuses}::text[])
              RETURNING id, recipient, email_type, status
            `;
          } else if (campaign) {
            deleted = await sql`
              DELETE FROM email_log
              WHERE email_type = ${campaign}
                AND status = ANY(${deletableStatuses}::text[])
              RETURNING id, recipient, email_type, status
            `;
          } else if (recipient) {
            deleted = await sql`
              DELETE FROM email_log
              WHERE recipient = ${recipient}
                AND status = ANY(${deletableStatuses}::text[])
              RETURNING id, recipient, email_type, status
            `;
          } else {
            return res.status(400).json({ error: "Provide ids[], campaign, or recipient" });
          }

          console.log(`[admin] deleted ${deleted.length} failed email_log rows`);
          return res.status(200).json({ deleted: deleted.length, rows: deleted });
        } catch (e: any) {
          return res.status(500).json({ error: `Delete failed: ${e?.message}` });
        }
      }

      // -- API usage analytics --
      case "api-analytics": {
        const range = parseRange(req.body, 30);
        const win = rangeClause(range, "created_at", 1);

        const [kpis] = await sql`
          SELECT
            COUNT(DISTINCT ak.user_id)::int AS total_api_users,
            COUNT(*)::int AS total_keys,
            COUNT(*) FILTER (WHERE ak.is_active)::int AS active_keys,
            COALESCE(SUM(ak.total_requests), 0)::bigint AS total_requests,
            COALESCE(SUM(ak.total_credits), 0)::bigint AS total_credits_used
          FROM api_keys ak
        `;

        const dailyVolume = (await sql.query(
          `WITH ${bucketSeriesCte(range, "api_usage_log")},
           agg AS (
             SELECT date_trunc('${range.bucket}', created_at)::date AS bucket,
                    COUNT(*)::int AS requests,
                    COALESCE(SUM(credits_used), 0)::int AS credits,
                    COUNT(DISTINCT api_key_id)::int AS unique_keys,
                    COUNT(*) FILTER (WHERE status NOT IN ('200','ok','success'))::int AS errors
             FROM api_usage_log
             WHERE ${win.sql}
             GROUP BY 1
           )
           SELECT b.bucket AS day,
                  COALESCE(a.requests, 0)    AS requests,
                  COALESCE(a.credits, 0)     AS credits,
                  COALESCE(a.unique_keys, 0) AS unique_keys,
                  COALESCE(a.errors, 0)      AS errors
           FROM buckets b LEFT JOIN agg a ON a.bucket = b.bucket
           ORDER BY b.bucket`,
          win.params,
        )) as any[];

        // Ranked on windowed usage, not the lifetime counters on api_keys —
        // those never decay, so the "top consumers" table used to be frozen on
        // whoever was busiest six months ago.
        const topConsumers = (await sql.query(
          `WITH windowed AS (
             SELECT api_key_id,
                    COUNT(*)::int AS window_requests,
                    COALESCE(SUM(credits_used), 0)::int AS window_credits
             FROM api_usage_log
             WHERE ${win.sql}
             GROUP BY api_key_id
           )
           SELECT u.email, ak.name AS key_name, ak.key_prefix,
                  ak.total_requests::int, ak.total_credits::int,
                  ak.last_used_at, ak.created_at, ak.is_active,
                  COALESCE(w.window_requests, 0) AS window_requests,
                  COALESCE(w.window_credits, 0)  AS window_credits
           FROM api_keys ak
           JOIN users u ON u.id = ak.user_id
           LEFT JOIN windowed w ON w.api_key_id = ak.id
           WHERE ak.is_active = true
           ORDER BY COALESCE(w.window_credits, 0) DESC, ak.total_credits DESC
           LIMIT 20`,
          win.params,
        )) as any[];

        const [apiRevenue] = (await sql.query(
          `SELECT
             COALESCE(SUM(credits_used), 0)::int AS total_credits,
             COALESCE(SUM(credits_used) FILTER (WHERE ${win.sql}), 0)::int AS credits_window,
             COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS credits_30d,
             COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '7 days'), 0)::int AS credits_7d,
             COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '24 hours'), 0)::int AS credits_today
           FROM api_usage_log`,
          win.params,
        )) as any[];

        const byAction = (await sql.query(
          `SELECT action,
                  COUNT(*)::int AS count,
                  COALESCE(SUM(credits_used), 0)::int AS credits,
                  COUNT(DISTINCT api_key_id)::int AS keys
           FROM api_usage_log
           WHERE ${win.sql}
           GROUP BY action
           ORDER BY credits DESC`,
          win.params,
        )) as any[];

        // Value the API window at the same realized ¢/credit the rest of the
        // panel uses, instead of the hardcoded 7.5¢ the old comment assumed.
        const [creditPrice] = (await sql.query(
          `WITH rev AS (
             SELECT COALESCE(SUM(amount_cents), 0)::int AS cents
             FROM transactions WHERE ${SQL_IS_REVENUE} AND ${win.sql}
           ),
           used AS (
             SELECT COALESCE(SUM(${SQL_NET_CREDITS}), 0)::int AS credits
             FROM usage_log WHERE ${win.sql} AND ${SQL_IS_JOB}
           )
           SELECT rev.cents, used.credits,
                  CASE WHEN used.credits > 0
                       THEN rev.cents::numeric / used.credits ELSE 0 END AS cents_per_credit
           FROM rev, used`,
          win.params,
        )) as any[];

        return res.status(200).json({
          range: { days: range.days, bucket: range.bucket, label: range.label },
          kpis,
          dailyVolume,
          topConsumers,
          apiRevenue,
          byAction,
          centsPerCredit: Number(creditPrice.cents_per_credit),
          impliedRevenueCents: Math.round(
            Number(creditPrice.cents_per_credit) * Number(apiRevenue.credits_window),
          ),
        });
      }

      case "announcement-stats": {
        const campaign = (req.body.campaign as string) || "announcement";
        const [{ total_verified }] = await sql`SELECT COUNT(*)::int AS total_verified FROM users WHERE email_verified = true`;
        const [{ already_sent }] = await sql`SELECT COUNT(DISTINCT recipient)::int AS already_sent FROM email_log WHERE email_type = ${campaign} AND status = 'sent'`;
        return res.status(200).json({ campaign, totalVerified: total_verified, alreadySent: already_sent, remaining: total_verified - already_sent });
      }

      case "get-announcement-html": {
        const campaign = (req.body.campaign as string) || "announcement";
        const html = getAnnouncementHtmlForCampaign(campaign);
        return res.status(200).json({ html, campaign });
      }

      case "queue-campaign": {
        const campaign = (req.body.campaign as string) || "announcement";
        const customSubject = req.body.subject || null;
        const customHtml = req.body.html || null;
        const batchSize = Math.min(Math.max(Number(req.body.batchSize) || 50, 1), 100);

        const existing = await readActiveCampaign(sql);
        if (existing && existing.campaign !== campaign) {
          return res.status(409).json({
            error: `Another campaign is active: "${existing.campaign}". Cancel it first or wait for completion.`,
            activeCampaign: existing.campaign,
          });
        }

        await sql`DELETE FROM announcement_cancels WHERE campaign = ${campaign}`;

        const remaining = await getCampaignRemaining(sql, campaign);
        const job: CampaignJob = {
          campaign,
          subject: customSubject || getDefaultSubject(campaign),
          html: customHtml,
          status: "active",
          startedAt: new Date().toISOString(),
          batchSize,
          totalSent: 0,
          totalFailed: 0,
        };
        await saveCampaignJob(sql, job);

        console.log(`[admin] Queued email campaign "${campaign}" — ${remaining} recipients remaining, batch=${batchSize}`);

        return res.status(200).json({
          queued: true,
          campaign,
          remaining,
          batchSize,
          subject: job.subject,
          message: "Campaign queued. Vercel cron processes batches every 2 minutes until complete.",
        });
      }

      case "campaign-status": {
        const campaign = (req.body.campaign as string) || null;
        const job = await readActiveCampaign(sql);
        const activeCampaign = job?.campaign ?? null;

        if (campaign && activeCampaign && campaign !== activeCampaign) {
          const remaining = await getCampaignRemaining(sql, campaign);
          return res.status(200).json({
            active: false,
            campaign,
            remaining,
            job: null,
          });
        }

        const targetCampaign = campaign || activeCampaign || "announcement";
        const remaining = await getCampaignRemaining(sql, targetCampaign);

        // Also read completed/cancelled job metadata if no longer active
        let jobMeta: CampaignJob | null = job;
        if (!jobMeta) {
          const rows = await sql`SELECT value FROM app_config WHERE key = ${CAMPAIGN_CONFIG_KEY} LIMIT 1`;
          if (rows.length) {
            const raw = (rows[0] as { value: unknown }).value;
            if (raw && typeof raw === "object") jobMeta = raw as CampaignJob;
          }
        }

        return res.status(200).json({
          active: !!job && job.status === "active",
          campaign: targetCampaign,
          remaining,
          job: jobMeta,
        });
      }

      case "send-announcement": {
        const batchSize = req.body.batchSize || 25;
        const offset = req.body.offset || 0;
        const dryRun = req.body.dryRun || false;
        const customSubject = req.body.subject || null;
        const customHtml = req.body.html || null;
        const campaign = (req.body.campaign as string) || "announcement";
        const background = req.body.background === true || req.body._bg === true;

        // Cancel handling for background mode.
        // - The FIRST batch (initiated by an admin via JWT, _bg=false) clears
        //   any stale cancel flag so a new campaign can start cleanly.
        // - Subsequent self-continuation batches (_bg=true) check the flag
        //   and abort if set.
        if (background) {
          const isContinuation = req.body._bg === true;
          if (!isContinuation) {
            try { await sql`DELETE FROM announcement_cancels WHERE campaign = ${campaign}`; }
            catch (e: any) { console.warn("[admin] failed to clear stale cancel:", e?.message); }
          } else {
            try {
              const cancelRows = await sql`
                SELECT 1 FROM announcement_cancels WHERE campaign = ${campaign} LIMIT 1
              `;
              if (cancelRows.length > 0) {
                console.log(`[admin] bg announcement: cancel signal found for "${campaign}", stopping loop`);
                return res.status(200).json({
                  sent: 0,
                  failed: 0,
                  campaign,
                  cancelled: true,
                  background: true,
                  hasMore: false,
                  remainingAfter: 0,
                });
              }
            } catch (e: any) {
              console.warn("[admin] cancel check failed (table missing?):", e?.message);
            }
          }
        }

        // Get verified users who haven't already received THIS campaign.
        // In background mode the offset is ALWAYS 0 because each batch
        // already-sent users are filtered out by the dedupe subquery.
        const effectiveOffset = background ? 0 : offset;

        const users = await sql`
          SELECT u.email FROM users u
          WHERE u.email_verified = true
            AND u.email NOT IN (
              SELECT recipient FROM email_log
              WHERE email_type = ${campaign} AND status = 'sent'
            )
          ORDER BY u.created_at ASC
          LIMIT ${batchSize} OFFSET ${effectiveOffset}
        `;

        // Get total count for progress tracking
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM users u
          WHERE u.email_verified = true
            AND u.email NOT IN (
              SELECT recipient FROM email_log
              WHERE email_type = ${campaign} AND status = 'sent'
            )
        `;

        if (dryRun) {
          return res.status(200).json({
            dryRun: true,
            campaign,
            totalUsers: count,
            batchSize,
            offset,
            batchEmails: users.map((u: any) => u.email),
            nextOffset: offset + batchSize,
            hasMore: offset + batchSize < count,
          });
        }

        let sent = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const user of users) {
          try {
            const ok = await sendAnnouncementEmail(user.email, customSubject, customHtml, campaign);
            if (ok) sent++;
            else { failed++; errors.push(user.email); }
            // Small delay to avoid rate limits
            await new Promise((r) => setTimeout(r, 100));
          } catch (err: any) {
            failed++;
            errors.push(user.email);
          }
        }

        // Background mode: kick off the next batch as a server-to-server
        // call before returning. We MUST await the fetch on Vercel —
        // unawaited promises are killed when the parent function returns,
        // which silently breaks the self-continuation loop. We only await
        // until the child request has been ACCEPTED (headers received) by
        // setting a short timeout, then abort the response stream so the
        // child keeps processing on its own function instance while we
        // return to the admin UI quickly.
        const remainingAfter = count - users.length;
        let bgQueued = false;
        let bgQueueError: string | null = null;
        if (background && users.length > 0 && remainingAfter > 0) {
          if (!cronSecret) {
            bgQueueError = "CRON_SECRET not set — cannot self-continue";
            console.warn("[admin] " + bgQueueError);
          } else {
            try {
              const proto = (req.headers["x-forwarded-proto"] as string) || "https";
              const host = req.headers["host"];
              const selfUrl = `${proto}://${host}/api/admin`;

              // Abort the child fetch after 2.5s — long enough for Vercel
              // to spin up the child function and start executing it,
              // short enough that the admin UI doesn't wait on a full batch.
              const ac = new AbortController();
              const abortTimer = setTimeout(() => ac.abort(), 2500);

              try {
                await fetch(selfUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-bg-secret": cronSecret,
                  },
                  body: JSON.stringify({
                    action: "send-announcement",
                    background: true,
                    _bg: true,
                    batchSize,
                    campaign,
                    subject: customSubject,
                    html: customHtml,
                  }),
                  signal: ac.signal,
                });
                bgQueued = true;
              } catch (e: any) {
                // AbortError is EXPECTED — the child kept running, we just
                // stopped reading its response. Anything else is a real
                // queueing failure.
                if (e?.name === "AbortError") {
                  bgQueued = true;
                } else {
                  bgQueueError = e?.message || String(e);
                  console.error("[admin] bg continue fetch failed:", bgQueueError);
                }
              } finally {
                clearTimeout(abortTimer);
              }
              console.log(`[admin] bg announcement: ${bgQueued ? "queued" : "FAILED to queue"} next batch, ${remainingAfter} users remaining`);
            } catch (e: any) {
              bgQueueError = e?.message || String(e);
              console.error("[admin] bg continue setup failed:", bgQueueError);
            }
          }
        }

        return res.status(200).json({
          sent,
          failed,
          campaign,
          errors: errors.slice(0, 20),
          totalUsers: count,
          offset,
          nextOffset: offset + batchSize,
          hasMore: offset + batchSize < count,
          background,
          remainingAfter,
          bgQueued,
          bgQueueError,
        });
      }

      case "cancel-announcement": {
        const campaign = (req.body.campaign as string) || "announcement";
        try {
          await sql`
            INSERT INTO announcement_cancels (campaign, cancelled_at)
            VALUES (${campaign}, now())
            ON CONFLICT (campaign) DO UPDATE SET cancelled_at = now()
          `;
          console.log(`[admin] cancel signal set for campaign "${campaign}"`);
          return res.status(200).json({ cancelled: true, campaign });
        } catch (e: any) {
          return res.status(500).json({ error: `Cancel failed: ${e?.message}` });
        }
      }

      case "resume-announcement": {
        // Removes the cancel flag so a new send-announcement (foreground or
        // background) can proceed for this campaign.
        const campaign = (req.body.campaign as string) || "announcement";
        try {
          await sql`DELETE FROM announcement_cancels WHERE campaign = ${campaign}`;
          return res.status(200).json({ cleared: true, campaign });
        } catch (e: any) {
          return res.status(500).json({ error: `Clear failed: ${e?.message}` });
        }
      }

      case "announcement-cancel-status": {
        const campaign = (req.body.campaign as string) || "announcement";
        try {
          const rows = await sql`
            SELECT cancelled_at FROM announcement_cancels WHERE campaign = ${campaign} LIMIT 1
          `;
          return res.status(200).json({
            cancelled: rows.length > 0,
            cancelledAt: rows[0]?.cancelled_at || null,
            campaign,
          });
        } catch {
          return res.status(200).json({ cancelled: false, campaign });
        }
      }

      case "list-mods": {
        const mods = await sql`
          SELECT fm.user_id, fm.created_at, u.email, p.username
          FROM feed_moderators fm
          JOIN users u ON u.id = fm.user_id
          LEFT JOIN profiles p ON p.user_id = fm.user_id
          ORDER BY fm.created_at DESC
        `;
        return res.json({ mods });
      }

      case "add-mod": {
        const { email: modEmail } = req.body;
        if (!modEmail) return res.status(400).json({ error: "email required" });
        const userRows = await sql`SELECT id FROM users WHERE email = ${String(modEmail).trim().toLowerCase()}`;
        if (userRows.length === 0) return res.status(404).json({ error: "User not found" });
        await sql`INSERT INTO feed_moderators (user_id, granted_by) VALUES (${userRows[0].id}, ${ADMIN_EMAIL}) ON CONFLICT DO NOTHING`;
        return res.json({ success: true, userId: userRows[0].id });
      }

      case "remove-mod": {
        const { userId: rmUserId } = req.body;
        if (!rmUserId) return res.status(400).json({ error: "userId required" });
        await sql`DELETE FROM feed_moderators WHERE user_id = ${rmUserId}`;
        return res.json({ success: true });
      }

      // ── Flash Sales CRUD ──────────────────────────────────────

      case "flash-sales-list": {
        const sales = await sql`
          SELECT * FROM xrge_flash_sales ORDER BY created_at DESC LIMIT 50
        `;
        return res.json({ sales });
      }

      case "flash-sales-create": {
        const { title, discountPercent, bonusCreditsPercent, packages: pkgs, durationMinutes } = req.body;
        if (!title || !discountPercent || !durationMinutes) {
          return res.status(400).json({ error: "title, discountPercent, and durationMinutes required" });
        }
        const dp = Math.min(90, Math.max(1, parseInt(discountPercent)));
        const bp = Math.min(500, Math.max(0, parseInt(bonusCreditsPercent || "0")));
        const dur = Math.max(1, parseInt(durationMinutes));
        const maxUses = req.body.maxUses ? parseInt(req.body.maxUses) : null;
        const packagesArr = pkgs && Array.isArray(pkgs) && pkgs.length > 0 ? pkgs : null;

        const rows = await sql`
          INSERT INTO xrge_flash_sales (title, discount_percent, bonus_credits_percent, packages, ends_at, max_uses)
          VALUES (${title}, ${dp}, ${bp}, ${packagesArr}, now() + ${dur + ' minutes'}::interval, ${maxUses})
          RETURNING *
        `;
        console.log(`[admin] Flash sale created: "${title}" ${dp}% off + ${bp}% bonus for ${dur}min`);
        return res.json({ sale: rows[0] });
      }

      case "flash-sales-end": {
        const { saleId } = req.body;
        if (!saleId) return res.status(400).json({ error: "saleId required" });
        await sql`UPDATE xrge_flash_sales SET active = false WHERE id = ${saleId}::uuid`;
        return res.json({ success: true });
      }

      // ── User Bans ──

      case "list-bans": {
        await sql`CREATE TABLE IF NOT EXISTS user_bans (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          reason TEXT NOT NULL DEFAULT 'Violation of community guidelines',
          banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ DEFAULT NULL
        )`.catch(() => {});
        // Add expires_at column if missing (idempotent)
        await sql`ALTER TABLE user_bans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL`.catch(() => {});
        const bans = await sql`
          SELECT ub.user_id, ub.reason, ub.created_at, ub.expires_at, u.email
          FROM user_bans ub
          JOIN users u ON u.id = ub.user_id
          ORDER BY ub.created_at DESC
        `;
        return res.json({ bans });
      }

      case "ban-user": {
        const { email: banEmail, userId: banUserId, reason: banReason, duration } = req.body;
        if (!banEmail && !banUserId) return res.status(400).json({ error: "email or userId required" });
        await sql`CREATE TABLE IF NOT EXISTS user_bans (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          reason TEXT NOT NULL DEFAULT 'Violation of community guidelines',
          banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ DEFAULT NULL
        )`.catch(() => {});
        await sql`ALTER TABLE user_bans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL`.catch(() => {});
        let targetId = banUserId;
        if (!targetId) {
          const [target] = await sql`SELECT id FROM users WHERE email = ${banEmail.trim().toLowerCase()}`;
          if (!target) return res.status(404).json({ error: "User not found" });
          targetId = target.id;
        }
        // The owner account is not bannable. ban-user is in MOD_ALLOWED_ACTIONS,
        // so without this a feed moderator could ban the admin (and wipe their
        // karma), locking them out of feed/chat/generation.
        const [targetRow] = await sql`SELECT email FROM users WHERE id = ${targetId}::uuid`;
        if (targetRow?.email === ADMIN_EMAIL) {
          return res.status(403).json({ error: "Cannot ban the owner account" });
        }
        // Calculate expires_at from duration (hours). null/0 = permanent.
        const DURATION_MAP: Record<string, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };
        let expiresAt: string | null = null;
        if (duration && DURATION_MAP[duration]) {
          const d = new Date();
          d.setHours(d.getHours() + DURATION_MAP[duration]);
          expiresAt = d.toISOString();
        }
        const adminAuth = getUserFromRequest(req);
        await sql`
          INSERT INTO user_bans (user_id, reason, banned_by, expires_at)
          VALUES (${targetId}::uuid, ${banReason || 'Violation of community guidelines'}, ${adminAuth?.userId || null}::uuid, ${expiresAt}::timestamptz)
          ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = now(), expires_at = EXCLUDED.expires_at
        `;
        // Zero karma on ban so the karma-based posting unlock cannot survive a sanction.
        await sql`UPDATE users SET karma = 0 WHERE id = ${targetId}::uuid`.catch(() => {});
        await sql`DELETE FROM karma_events WHERE user_id = ${targetId}::uuid`.catch(() => {});
        console.log(`[admin] Banned user ${banEmail || banUserId} — reason: ${banReason || 'none'} — duration: ${duration || 'permanent'}`);
        return res.json({ success: true });
      }

      case "unban-user": {
        const { userId: unbanId } = req.body;
        if (!unbanId) return res.status(400).json({ error: "userId required" });
        await sql`DELETE FROM user_bans WHERE user_id = ${unbanId}::uuid`;
        console.log(`[admin] Unbanned user ${unbanId}`);
        return res.json({ success: true });
      }

      // ── User Inspector ──
      case "user-inspect": {
        const { email: inspectEmail, userId: inspectUserId } = req.body;
        if (!inspectEmail && !inspectUserId) return res.status(400).json({ error: "email or userId required" });

        let targetId = inspectUserId;
        let userRow: any;
        if (inspectEmail) {
          const rows = await sql`SELECT id, email, created_at, subscription_tier, sub_credits, pack_credits, daily_credits, verification_status, verification_renews_at FROM users WHERE email = ${inspectEmail.trim().toLowerCase()} LIMIT 1`;
          if (rows.length === 0) return res.status(404).json({ error: "User not found" });
          userRow = rows[0];
          targetId = userRow.id;
        } else {
          const rows = await sql`SELECT id, email, created_at, subscription_tier, sub_credits, pack_credits, daily_credits, verification_status, verification_renews_at FROM users WHERE id = ${inspectUserId}::uuid LIMIT 1`;
          if (rows.length === 0) return res.status(404).json({ error: "User not found" });
          userRow = rows[0];
        }

        // Get profile
        const profileRows = await sql`SELECT username, bio, avatar_url FROM profiles WHERE user_id = ${targetId}::uuid LIMIT 1`.catch(() => []);
        const profile = profileRows[0] || null;

        // Recent prompts (last 50)
        const prompts = await sql`
          SELECT mode, credits_used, prompt, api_cost_cents, created_at
          FROM usage_log
          WHERE user_id = ${targetId}::uuid
          ORDER BY created_at DESC
          LIMIT 50
        `.catch(() => []);

        // Feed posts (last 30)
        const posts = await sql`
          SELECT id, text, image_url, created_at
          FROM feed_posts
          WHERE user_id = ${targetId}::uuid
          ORDER BY created_at DESC
          LIMIT 30
        `.catch(() => []);

        // Stories (last 20)
        const stories = await sql`
          SELECT id, media_url, media_type, caption, prompt, created_at, expires_at
          FROM stories
          WHERE user_id = ${targetId}::uuid
          ORDER BY created_at DESC
          LIMIT 20
        `.catch(() => []);

        // Ban status
        const banRows = await sql`SELECT reason, created_at, expires_at FROM user_bans WHERE user_id = ${targetId}::uuid LIMIT 1`.catch(() => []);
        const ban = banRows.length > 0 ? banRows[0] : null;

        // Moderation flags
        const [modStats] = await sql`
          SELECT COUNT(*)::int AS total_flags
          FROM usage_log
          WHERE user_id = ${targetId}::uuid AND mode LIKE 'moderation-%'
        `.catch(() => [{ total_flags: 0 }]);

        // Purchase history (last 30 transactions)
        const transactions = await sql`
          SELECT id, credits, amount_cents, package, type, payment_method,
                 stripe_session_id, created_at
          FROM transactions
          WHERE user_id = ${targetId}::uuid
          ORDER BY created_at DESC
          LIMIT 30
        `.catch(() => []);

        const [spendStats] = await sql`
          SELECT
            COALESCE(SUM(amount_cents), 0)::int AS total_spent_cents,
            COUNT(*)::int AS total_purchases
          FROM transactions
          WHERE user_id = ${targetId}::uuid AND amount_cents > 0
        `.catch(() => [{ total_spent_cents: 0, total_purchases: 0 }]);

        return res.json({
          user: { ...userRow, ...profile },
          prompts,
          posts,
          stories,
          ban,
          moderationFlags: modStats.total_flags,
          transactions,
          totalSpentCents: spendStats.total_spent_cents,
          totalPurchases: spendStats.total_purchases,
        });
      }

      // ── Grant Verification (admin override) ──
      case "grant-verification": {
        const { email: gvEmail, userId: gvUserId, durationDays } = req.body;
        if (!gvEmail && !gvUserId) return res.status(400).json({ error: "email or userId required" });
        const userRows = gvEmail
          ? await sql`SELECT id, email FROM users WHERE email = ${String(gvEmail).trim().toLowerCase()} LIMIT 1`
          : await sql`SELECT id, email FROM users WHERE id = ${gvUserId}::uuid LIMIT 1`;
        if (userRows.length === 0) return res.status(404).json({ error: "User not found" });
        const targetId = userRows[0].id;
        const days = Number.isFinite(Number(durationDays)) && Number(durationDays) > 0 ? Number(durationDays) : 365;
        await sql`
          UPDATE users
          SET verification_status = 'verified',
              verified_at = COALESCE(verified_at, now()),
              verification_renews_at = now() + (${days} || ' days')::interval,
              verification_lapsed_at = NULL,
              updated_at = now()
          WHERE id = ${targetId}::uuid
        `;
        console.log(`[admin] Granted verification to ${userRows[0].email} for ${days}d`);
        return res.json({ success: true, userId: targetId, durationDays: days });
      }

      case "revoke-verification": {
        const { email: rvEmail, userId: rvUserId } = req.body;
        if (!rvEmail && !rvUserId) return res.status(400).json({ error: "email or userId required" });
        const userRows = rvEmail
          ? await sql`SELECT id, email FROM users WHERE email = ${String(rvEmail).trim().toLowerCase()} LIMIT 1`
          : await sql`SELECT id, email FROM users WHERE id = ${rvUserId}::uuid LIMIT 1`;
        if (userRows.length === 0) return res.status(404).json({ error: "User not found" });
        const targetId = userRows[0].id;
        await sql`
          UPDATE users
          SET verification_status = 'unverified',
              verification_renews_at = NULL,
              verification_lapsed_at = now(),
              updated_at = now()
          WHERE id = ${targetId}::uuid
        `;
        console.log(`[admin] Revoked verification for ${userRows[0].email}`);
        return res.json({ success: true, userId: targetId });
      }

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (err: any) {
    console.error("[admin]", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

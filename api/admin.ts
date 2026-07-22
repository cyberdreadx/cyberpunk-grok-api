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
      case "overview": {
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

        const [revenueStats] = await sql`
          SELECT
            COALESCE(SUM(amount_cents), 0)::int AS total_revenue_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS revenue_30d_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE created_at > now() - interval '7 days'), 0)::int AS revenue_7d_cents,
            COUNT(*)::int AS total_transactions,
            COUNT(*) FILTER (WHERE type = 'pack')::int AS pack_purchases,
            COUNT(*) FILTER (WHERE type = 'subscription')::int AS sub_renewals
          FROM transactions
        `;

        const [usageStats] = await sql`
          SELECT
            COALESCE(SUM(credits_used), 0)::int AS total_credits_used,
            COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS credits_30d,
            COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '24 hours'), 0)::int AS credits_today,
            COUNT(*)::int AS total_generations,
            COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS generations_today
          FROM usage_log
        `;

        const [creditPool] = await sql`
          SELECT
            COALESCE(SUM(sub_credits), 0)::int AS total_sub_credits_outstanding,
            COALESCE(SUM(pack_credits), 0)::int AS total_pack_credits_outstanding
          FROM users
        `;

        // Estimate API cost:
        //   Successful images: $0.02/image (2 cents)
        //   Moderated images: $0.05/image (5 cents) -- xAI charges more for blocked content!
        //   Video: $0.05/sec (5 cents) -- same whether successful or blocked
        const [costEstimate] = await sql`
          SELECT
            COALESCE(SUM(
              CASE
                WHEN mode IN ('moderation-image','moderation-edit') THEN credits_used * 5
                WHEN mode IN ('generate-image','edit-image') THEN credits_used * 2
                ELSE credits_used * 5
              END
            ) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS estimated_cost_30d_cents,
            COALESCE(SUM(
              CASE
                WHEN mode IN ('moderation-image','moderation-edit') THEN credits_used * 5
                WHEN mode IN ('generate-image','edit-image') THEN credits_used * 2
                ELSE credits_used * 5
              END
            ), 0)::int AS estimated_cost_total_cents
          FROM usage_log
        `;

        // RunPod cost from tracked execution times (rate: $0.00155/s = 0.155 cents/s)
        let runpodCost30dCents = 0;
        try {
          const [runpodCost] = await sql`
            SELECT
              COALESCE(SUM(execution_time_ms) FILTER (WHERE created_at > now() - interval '30 days'), 0)::bigint AS total_ms_30d
            FROM usage_log
            WHERE mode LIKE 'comfy-%' AND execution_time_ms IS NOT NULL
          `;
          runpodCost30dCents = Math.round((Number(runpodCost.total_ms_30d) / 1000) * 0.155);
        } catch { /* column may not exist yet */ }

        // Actual tracked API costs (from api_cost_cents column)
        let actualCosts = { actual_cost_30d_cents: 0, actual_cost_total_cents: 0, tracked_30d: 0, total_30d: 0 };
        try {
          const [ac] = await sql`
            SELECT
              COALESCE(SUM(api_cost_cents) FILTER (WHERE created_at > now() - interval '30 days'), 0)::numeric AS actual_cost_30d_cents,
              COALESCE(SUM(api_cost_cents), 0)::numeric AS actual_cost_total_cents,
              COUNT(api_cost_cents) FILTER (WHERE created_at > now() - interval '30 days')::int AS tracked_30d,
              COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS total_30d
            FROM usage_log
          `;
          actualCosts = ac;
        } catch { /* column may not exist yet */ }

        // Moderation stats
        const [moderationStats] = await sql`
          SELECT
            COUNT(*)::int AS total_blocks,
            COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS blocks_30d,
            COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS blocks_today,
            COALESCE(SUM(credits_used), 0)::int AS total_credits_burned,
            COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS credits_burned_30d,
            COALESCE(SUM(
              CASE WHEN mode IN ('moderation-image','moderation-edit') THEN credits_used * 5 ELSE credits_used * 5 END
            ), 0)::int AS wasted_cost_total_cents,
            COALESCE(SUM(
              CASE WHEN mode IN ('moderation-image','moderation-edit') THEN credits_used * 5 ELSE credits_used * 5 END
            ) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS wasted_cost_30d_cents
          FROM usage_log
          WHERE mode LIKE 'moderation-%'
        `;

        // Top moderation offenders
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

        return res.status(200).json({
          users: userStats,
          revenue: revenueStats,
          usage: usageStats,
          creditPool,
          apiCost: {
            estimated30dCents: costEstimate.estimated_cost_30d_cents,
            estimatedTotalCents: costEstimate.estimated_cost_total_cents,
          },
          runpodCost: {
            estimated30dCents: runpodCost30dCents,
          },
          actualCost: {
            actual30dCents: Number(actualCosts.actual_cost_30d_cents),
            actualTotalCents: Number(actualCosts.actual_cost_total_cents),
            tracked30d: actualCosts.tracked_30d,
            total30d: actualCosts.total_30d,
          },
          moderation: {
            ...moderationStats,
            offenders: moderationOffenders,
          },
        });
      }

      // -- Revenue breakdown by pack/type/gateway --
      case "revenue-breakdown": {
        const byPack = await sql`
          SELECT
            package,
            type,
            COUNT(*)::int AS count,
            SUM(amount_cents)::int AS total_cents,
            SUM(credits)::int AS total_credits
          FROM transactions
          GROUP BY package, type
          ORDER BY total_cents DESC
        `;
        const byGateway = await sql`
          SELECT
            CASE
              WHEN payment_method = 'xrge' THEN 'xrge'
              WHEN payment_method = 'paypal' THEN 'paypal'
              WHEN stripe_session_id IS NOT NULL THEN 'stripe'
              ELSE 'other'
            END AS gateway,
            COUNT(*)::int AS count,
            SUM(amount_cents)::int AS total_cents
          FROM transactions
          GROUP BY 1
          ORDER BY total_cents DESC
        `;
        const byPack30d = await sql`
          SELECT
            package,
            type,
            COUNT(*)::int AS count,
            SUM(amount_cents)::int AS total_cents,
            SUM(credits)::int AS total_credits
          FROM transactions
          WHERE created_at > now() - interval '30 days'
          GROUP BY package, type
          ORDER BY total_cents DESC
        `;
        return res.status(200).json({ byPack, byGateway, byPack30d });
      }

      // -- Revenue time series (daily, last 30 days) --
      case "revenue": {
        const rows = await sql`
          SELECT
            date_trunc('day', created_at)::date AS day,
            SUM(amount_cents)::int AS revenue_cents,
            COUNT(*)::int AS tx_count,
            COUNT(*) FILTER (WHERE type = 'pack')::int AS packs,
            COUNT(*) FILTER (WHERE type = 'subscription')::int AS subs
          FROM transactions
          WHERE created_at > now() - interval '30 days'
          GROUP BY 1
          ORDER BY 1
        `;
        return res.status(200).json({ revenue: rows });
      }

      // -- User growth time series (daily, last 30 days) --
      case "users": {
        const rows = await sql`
          SELECT
            day,
            new_users,
            SUM(new_users) OVER (ORDER BY day)::int AS cumulative
          FROM (
            SELECT
              date_trunc('day', created_at)::date AS day,
              COUNT(*)::int AS new_users
            FROM users
            GROUP BY 1
          ) daily
          ORDER BY day
        `;
        return res.status(200).json({ users: rows });
      }

      // -- Generation volume by mode (daily, last 30 days) --
      case "usage": {
        const rows = await sql`
          SELECT
            date_trunc('day', created_at)::date AS day,
            mode,
            COUNT(*)::int AS count,
            SUM(credits_used)::int AS credits
          FROM usage_log
          WHERE created_at > now() - interval '30 days'
          GROUP BY 1, 2
          ORDER BY 1
        `;
        return res.status(200).json({ usage: rows });
      }

      // -- Transaction log (last 100 transactions) --
      case "transactions": {
        const rows = await sql`
          SELECT
            t.created_at,
            u.email,
            t.type,
            t.package,
            t.credits,
            t.amount_cents,
            CASE
              WHEN t.payment_method = 'xrge' THEN 'xrge'
              WHEN t.payment_method = 'paypal' THEN 'paypal'
              WHEN t.stripe_session_id IS NOT NULL THEN 'stripe'
              ELSE 'other'
            END AS gateway
          FROM transactions t
          LEFT JOIN users u ON u.id = t.user_id
          ORDER BY t.created_at DESC
          LIMIT 100
        `;
        return res.status(200).json({ transactions: rows });
      }

      // -- Top users by credit usage --
      case "top-users": {
        const rows = await sql`
          SELECT
            u.email,
            u.subscription_tier,
            u.subscription_cancel_at,
            u.sub_credits,
            u.pack_credits,
            u.created_at,
            COALESCE(t.total_spent_cents, 0)::int AS total_spent_cents,
            COALESCE(g.total_generations, 0)::int AS total_generations,
            COALESCE(g.total_credits_used, 0)::int AS total_credits_used,
            g.last_generation
          FROM users u
          LEFT JOIN LATERAL (
            SELECT SUM(amount_cents) AS total_spent_cents
            FROM transactions WHERE user_id = u.id
          ) t ON true
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) AS total_generations,
              SUM(credits_used) AS total_credits_used,
              MAX(created_at) AS last_generation
            FROM usage_log WHERE user_id = u.id
          ) g ON true
          ORDER BY COALESCE(g.total_credits_used, 0) DESC
          LIMIT 25
        `;
        return res.status(200).json({ topUsers: rows });
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

      // -- Profit per action breakdown (30d) --
      case "profit-breakdown": {
        try {
          const rows = await sql`
            SELECT
              mode,
              COUNT(*)::int AS generations,
              COALESCE(SUM(credits_used), 0)::int AS credits_used,
              COALESCE(SUM(execution_time_ms), 0)::bigint AS total_exec_ms,
              COUNT(execution_time_ms)::int AS tracked_count,
              COALESCE(SUM(api_cost_cents), 0)::numeric AS actual_cost_cents,
              COUNT(api_cost_cents)::int AS cost_tracked_count
            FROM usage_log
            WHERE created_at > now() - interval '30 days'
              AND mode NOT LIKE 'moderation-%'
            GROUP BY mode
            ORDER BY credits_used DESC
          `;
          return res.status(200).json({ profitBreakdown: rows });
        } catch {
          // Columns may not exist yet — return empty
          const rows = await sql`
            SELECT mode, COUNT(*)::int AS generations, COALESCE(SUM(credits_used), 0)::int AS credits_used,
              0::bigint AS total_exec_ms, 0::int AS tracked_count, 0::numeric AS actual_cost_cents, 0::int AS cost_tracked_count
            FROM usage_log
            WHERE created_at > now() - interval '30 days' AND mode NOT LIKE 'moderation-%'
            GROUP BY mode ORDER BY credits_used DESC
          `;
          return res.status(200).json({ profitBreakdown: rows });
        }
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
        // KPI overview
        const [kpis] = await sql`
          SELECT
            COUNT(DISTINCT ak.user_id)::int AS total_api_users,
            COUNT(*)::int AS total_keys,
            COUNT(*) FILTER (WHERE ak.is_active)::int AS active_keys,
            COALESCE(SUM(ak.total_requests), 0)::bigint AS total_requests,
            COALESCE(SUM(ak.total_credits), 0)::bigint AS total_credits_used
          FROM api_keys ak
        `;

        // Requests last 30 days by day
        const dailyVolume = await sql`
          SELECT
            date_trunc('day', created_at)::date AS day,
            COUNT(*)::int AS requests,
            SUM(credits_used)::int AS credits,
            COUNT(DISTINCT api_key_id)::int AS unique_keys
          FROM api_usage_log
          WHERE created_at > now() - interval '30 days'
          GROUP BY 1
          ORDER BY 1
        `;

        // Top API consumers
        const topConsumers = await sql`
          SELECT
            u.email,
            ak.name AS key_name,
            ak.key_prefix,
            ak.total_requests::int,
            ak.total_credits::int,
            ak.last_used_at,
            ak.created_at
          FROM api_keys ak
          JOIN users u ON u.id = ak.user_id
          WHERE ak.is_active = true
          ORDER BY ak.total_credits DESC
          LIMIT 20
        `;

        // Revenue from API usage (credits × avg credit price ~$0.075)
        const [apiRevenue] = await sql`
          SELECT
            COALESCE(SUM(credits_used), 0)::int AS total_credits,
            COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS credits_30d,
            COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '7 days'), 0)::int AS credits_7d,
            COALESCE(SUM(credits_used) FILTER (WHERE created_at > now() - interval '24 hours'), 0)::int AS credits_today
          FROM api_usage_log
        `;

        // Usage by action type
        const byAction = await sql`
          SELECT
            action,
            COUNT(*)::int AS count,
            SUM(credits_used)::int AS credits
          FROM api_usage_log
          WHERE created_at > now() - interval '30 days'
          GROUP BY action
          ORDER BY credits DESC
        `;

        return res.status(200).json({
          kpis,
          dailyVolume,
          topConsumers,
          apiRevenue,
          byAction,
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
        const userRows = await sql`SELECT id FROM users WHERE email = ${modEmail}`;
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

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
import { getUserFromRequest } from "./_lib/auth";

const ADMIN_EMAIL = "cyberdreadx@proton.me";

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

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

  // All POST actions require admin
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const sql = getDb();
  const { action } = req.body || {};

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
              WHEN paypal_capture_id IS NOT NULL THEN 'paypal'
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
              WHEN t.paypal_capture_id IS NOT NULL THEN 'paypal'
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

        // Top referrers
        const topReferrers = await sql`
          SELECT
            u.email,
            COUNT(*)::int AS referral_count,
            COUNT(*) FILTER (WHERE r.referee_purchased)::int AS conversions,
            COUNT(*) FILTER (WHERE r.referrer_rewarded)::int AS rewards
          FROM referrals r
          JOIN users u ON u.id = r.referrer_id
          GROUP BY u.email
          ORDER BY referral_count DESC
          LIMIT 10
        `;

        return res.status(200).json({
          referrals: {
            ...stats,
            conversionRate,
            creditsGranted,
            topReferrers,
          },
        });
      }

      // -- Sync subscription cancellation status from Stripe --
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
                current_period_end: s.current_period_end,
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
                  ? new Date(activeSub.current_period_end * 1000).toISOString()
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
            details.push({ email: user.email, action: "error", error: err.message });
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

      default:
        return res.status(400).json({ error: "Unknown action. Expected: overview, revenue, revenue-breakdown, users, usage, transactions, top-users, referrals, sync-subscriptions" });
    }
  } catch (err: any) {
    console.error("[admin]", err.message);
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
}

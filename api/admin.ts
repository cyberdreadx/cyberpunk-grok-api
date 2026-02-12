/**
 * /api/admin — Admin dashboard stats + health check.
 *
 * GET  (no auth)         → health check
 * POST { action: "overview" }  → high-level KPIs
 * POST { action: "revenue" }   → revenue time series
 * POST { action: "users" }     → user growth time series
 * POST { action: "usage" }     → generation volume by mode
 * POST { action: "top-users" } → top users by usage
 *
 * All POST actions require admin JWT (hardcoded admin email).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";

const ADMIN_EMAIL = "cyberdreadx@proton.me";

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Health check (GET, no auth) ──
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
      // ── Overview KPIs ──
      case "overview": {
        const [userStats] = await sql`
          SELECT
            COUNT(*)::int AS total_users,
            COUNT(*) FILTER (WHERE email_verified = true)::int AS verified_users,
            COUNT(*) FILTER (WHERE subscription_tier IS NOT NULL)::int AS active_subscribers,
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

        // Estimate API cost: ~$0.07 per image, ~$0.10 per video second
        const [costEstimate] = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN mode IN ('generate-image','edit-image') THEN credits_used * 7 ELSE credits_used * 10 END) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS estimated_cost_30d_hundredths,
            COALESCE(SUM(CASE WHEN mode IN ('generate-image','edit-image') THEN credits_used * 7 ELSE credits_used * 10 END), 0)::int AS estimated_cost_total_hundredths
          FROM usage_log
        `;

        return res.status(200).json({
          users: userStats,
          revenue: revenueStats,
          usage: usageStats,
          creditPool,
          apiCost: {
            estimated30dCents: Math.round(costEstimate.estimated_cost_30d_hundredths / 100),
            estimatedTotalCents: Math.round(costEstimate.estimated_cost_total_hundredths / 100),
          },
        });
      }

      // ── Revenue time series (daily, last 30 days) ──
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

      // ── User growth time series (daily, last 30 days) ──
      case "users": {
        const rows = await sql`
          SELECT
            date_trunc('day', created_at)::date AS day,
            COUNT(*)::int AS new_users,
            SUM(COUNT(*)) OVER (ORDER BY date_trunc('day', created_at))::int AS cumulative
          FROM users
          GROUP BY 1
          ORDER BY 1
        `;
        return res.status(200).json({ users: rows });
      }

      // ── Generation volume by mode (daily, last 30 days) ──
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

      // ── Transaction log (last 100 transactions) ──
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
              WHEN t.stripe_session_id IS NOT NULL THEN 'stripe'
              WHEN t.paypal_capture_id IS NOT NULL THEN 'paypal'
              ELSE 'unknown'
            END AS gateway
          FROM transactions t
          LEFT JOIN users u ON u.id = t.user_id
          ORDER BY t.created_at DESC
          LIMIT 100
        `;
        return res.status(200).json({ transactions: rows });
      }

      // ── Top users by credit usage ──
      case "top-users": {
        const rows = await sql`
          SELECT
            u.email,
            u.subscription_tier,
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

      default:
        return res.status(400).json({ error: "Unknown action. Expected: overview, revenue, users, usage, transactions, top-users" });
    }
  } catch (err: any) {
    console.error("[admin]", err.message);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
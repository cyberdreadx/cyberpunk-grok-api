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
import { sendAnnouncementEmail, buildAnnouncementHtml, buildV47AnnouncementHtml } from "./_lib/email";

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

  // Admins can perform all actions; feed mods only a small subset
  const admin = isAdmin(req);
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
        const html = campaign === "announcement_v47" ? buildV47AnnouncementHtml() : buildAnnouncementHtml();
        return res.status(200).json({ html, campaign });
      }

      case "send-announcement": {
        const batchSize = req.body.batchSize || 25;
        const offset = req.body.offset || 0;
        const dryRun = req.body.dryRun || false;
        const customSubject = req.body.subject || null;
        const customHtml = req.body.html || null;
        const campaign = (req.body.campaign as string) || "announcement";

        // Get verified users who haven't already received THIS campaign
        const users = await sql`
          SELECT u.email FROM users u
          WHERE u.email_verified = true
            AND u.email NOT IN (
              SELECT recipient FROM email_log
              WHERE email_type = ${campaign} AND status = 'sent'
            )
          ORDER BY u.created_at ASC
          LIMIT ${batchSize} OFFSET ${offset}
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

        return res.status(200).json({
          sent,
          failed,
          campaign,
          errors: errors.slice(0, 20),
          totalUsers: count,
          offset,
          nextOffset: offset + batchSize,
          hasMore: offset + batchSize < count,
        });
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

        return res.json({
          user: { ...userRow, ...profile },
          prompts,
          posts,
          stories,
          ban,
          moderationFlags: modStats.total_flags,
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

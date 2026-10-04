import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { checkRateLimit } from "./_lib/ratelimit";
import { getFreeCreditsConfig, FREE_CREDITS_MAINTENANCE_MESSAGE } from "./_lib/freeCredits";
import { getCombinedCreditDiscountPct } from "./_lib/discount";
import { FREE_CREDITS_SUBSCRIBER_ONLY_MESSAGE } from "./_lib/subscriberGate";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { allowed } = await checkRateLimit(auth.userId, "credits", { max: 60, windowSeconds: 60 });
    if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

    const sql = getDb();
    const rows = await sql`
      SELECT daily_credits, sub_credits, pack_credits, subscription_tier, subscription_renews_at, subscription_cancel_at, lora_unlocked,
             stripe_customer_id, COALESCE(xrge_lifetime_spend, 0)::numeric AS xrge_lifetime_spend,
             COALESCE(subscription_discount_pct, 0)::int AS subscription_discount_pct
      FROM users
      WHERE id = ${auth.userId}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const u = rows[0];
    const has_purchased = !!u.stripe_customer_id || !!u.subscription_tier || parseFloat(u.xrge_lifetime_spend || "0") > 0;
    const creditDiscountPct = await getCombinedCreditDiscountPct(auth.userId);
    const fcConfig = await getFreeCreditsConfig();
    const isSub = !!u.subscription_tier;
    const adminPaused = !fcConfig.daily && !fcConfig.spin && !fcConfig.missions;
    const freeCreditsDisabled = adminPaused || !isSub;
    const maintenanceMessage = !isSub
      ? FREE_CREDITS_SUBSCRIBER_ONLY_MESSAGE
      : adminPaused ? FREE_CREDITS_MAINTENANCE_MESSAGE : null;
    /*
     * What is due to expire, so it can be shown before it happens rather than
     * discovered after. Only credits granted with a lot appear here — anything
     * held before expiring credits shipped has no lot and never expires.
     */
    const expiringRows = (await sql`
      SELECT kind, SUM(remaining)::int AS amount, MIN(expires_at) AS next_at
      FROM credit_lots
      WHERE user_id = ${auth.userId}::uuid AND remaining > 0 AND expires_at > now()
      GROUP BY kind
    `.catch(() => [])) as any[];
    const [soonest] = (await sql`
      SELECT remaining::int AS amount, expires_at FROM credit_lots
      WHERE user_id = ${auth.userId}::uuid AND remaining > 0 AND expires_at > now()
      ORDER BY expires_at LIMIT 1
    `.catch(() => [])) as any[];
    return res.status(200).json({
      daily_credits: u.daily_credits,
      expiring: {
        promo: Number(expiringRows.find((r: any) => r.kind === "promo")?.amount ?? 0),
        paid: Number(expiringRows.find((r: any) => r.kind === "paid")?.amount ?? 0),
        next: soonest ? { amount: Number(soonest.amount), at: soonest.expires_at } : null,
      },
      sub_credits: u.sub_credits,
      pack_credits: u.pack_credits,
      subscription_tier: u.subscription_tier,
      subscription_renews_at: u.subscription_renews_at,
      subscription_cancel_at: u.subscription_cancel_at,
      subscription_discount_pct: u.subscription_discount_pct,
      /** Subscription + XRGE holder tier, combined (what generation billing uses). */
      credit_discount_pct: creditDiscountPct,
      lora_unlocked: u.lora_unlocked,
      has_purchased,
      free_credits_disabled: freeCreditsDisabled,
      free_credits_sources: { daily: fcConfig.daily, spin: fcConfig.spin, missions: fcConfig.missions },
      free_credits_subscriber_only: !isSub,
      maintenance_message: maintenanceMessage,
    });
  } catch (err: any) {
    console.error("[credits]", err.message);
    return res.status(500).json({ error: "Failed to fetch credits" });
  }
}

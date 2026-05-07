import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { checkRateLimit } from "./_lib/ratelimit";
import { getFreeCreditsConfig, FREE_CREDITS_MAINTENANCE_MESSAGE } from "./_lib/freeCredits";
import { getCombinedCreditDiscountPct } from "./_lib/discount";

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
    return res.status(200).json({
      daily_credits: u.daily_credits,
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
      free_credits_disabled: !fcConfig.daily && !fcConfig.spin && !fcConfig.missions,
      free_credits_sources: { daily: fcConfig.daily, spin: fcConfig.spin, missions: fcConfig.missions },
      maintenance_message: (!fcConfig.daily && !fcConfig.spin && !fcConfig.missions) ? FREE_CREDITS_MAINTENANCE_MESSAGE : null,
    });
  } catch (err: any) {
    console.error("[credits]", err.message);
    return res.status(500).json({ error: "Failed to fetch credits" });
  }
}

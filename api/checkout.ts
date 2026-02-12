/**
 * /api/checkout — Create Stripe checkout sessions (packs, subscriptions, portal).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

const PACKAGES: Record<string, { priceEnvKey: string; credits: number }> = {
  starter: { priceEnvKey: "STRIPE_PRICE_STARTER", credits: 50 },
  pro: { priceEnvKey: "STRIPE_PRICE_PRO", credits: 175 },
  mega: { priceEnvKey: "STRIPE_PRICE_MEGA", credits: 450 },
  ultra: { priceEnvKey: "STRIPE_PRICE_ULTRA", credits: 1800 },
  enterprise: { priceEnvKey: "STRIPE_PRICE_ENTERPRISE", credits: 4000 },
};

const SUBSCRIPTIONS: Record<string, { priceEnvKey: string; creditsPerMonth: number }> = {
  basic: { priceEnvKey: "STRIPE_PRICE_SUB_BASIC", creditsPerMonth: 150 },
  premium: { priceEnvKey: "STRIPE_PRICE_SUB_PREMIUM", creditsPerMonth: 500 },
  "basic-yearly": { priceEnvKey: "STRIPE_PRICE_SUB_BASIC_YEARLY", creditsPerMonth: 150 },
  "premium-yearly": { priceEnvKey: "STRIPE_PRICE_SUB_PREMIUM_YEARLY", creditsPerMonth: 500 },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const SITE_URL = process.env.SITE_URL || "http://localhost:5173";
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });

    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    // Rate limit: 10 checkout attempts per user per 5 minutes
    const { allowed } = await checkRateLimit(auth.userId, "checkout", { max: 10, windowSeconds: 300 });
    if (!allowed) {
      return res.status(429).json({ error: "Too many checkout attempts. Please wait a moment." });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const sql = getDb();
    const body = req.body || {};

    // ── Portal: redirect to Stripe Customer Portal ──
    if (body.action === "portal") {
      const rows = await sql`
        SELECT stripe_customer_id FROM users WHERE id = ${auth.userId}
      `;
      if (!rows[0]?.stripe_customer_id) {
        return res.status(404).json({ error: "No active subscription found" });
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: rows[0].stripe_customer_id,
        return_url: SITE_URL,
      });
      return res.status(200).json({ url: portalSession.url });
    }

    // ── Subscription checkout ──
    if (body.subscription) {
      const tierId = body.subscription as string;
      const tier = SUBSCRIPTIONS[tierId];
      if (!tier) return res.status(400).json({ error: `Unknown tier: ${tierId}` });

      const priceId = process.env[tier.priceEnvKey];
      if (!priceId) return res.status(500).json({ error: `Price not configured for ${tierId}` });

      // Find or create Stripe customer
      const rows = await sql`
        SELECT stripe_customer_id FROM users WHERE id = ${auth.userId}
      `;
      let customerId = rows[0]?.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: auth.email,
          metadata: { user_id: auth.userId },
        });
        customerId = customer.id;
        await sql`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${auth.userId}`;
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: auth.userId,
        metadata: { user_id: auth.userId, tier: tierId, credits_per_month: String(tier.creditsPerMonth) },
        subscription_data: {
          metadata: { user_id: auth.userId, tier: tierId, credits_per_month: String(tier.creditsPerMonth) },
        },
        success_url: `${SITE_URL}?checkout=success`,
        cancel_url: `${SITE_URL}?checkout=cancelled`,
      });
      return res.status(200).json({ url: session.url });
    }

    // ── One-time pack checkout ──
    const packageId = body.package as string;
    const pkg = PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: `Unknown package: ${packageId}` });

    const priceId = process.env[pkg.priceEnvKey];
    if (!priceId) return res.status(500).json({ error: `Price not configured for ${packageId}` });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: auth.userId,
      metadata: { user_id: auth.userId, package: packageId, credits: String(pkg.credits), type: "pack" },
      success_url: `${SITE_URL}?checkout=success`,
      cancel_url: `${SITE_URL}?checkout=cancelled`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    console.error("[checkout]", err.message, err.stack);
    return res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
}

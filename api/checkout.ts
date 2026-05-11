/**
 * /api/checkout — Create Stripe checkout sessions (packs, subscriptions, portal).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

// Pack credits — must stay in sync with src/lib/api.ts CREDIT_PACKAGES.
const PACKAGES: Record<string, { priceEnvKey: string; credits: number }> = {
  starter:    { priceEnvKey: "STRIPE_PRICE_STARTER",    credits: 75 },
  pro:        { priceEnvKey: "STRIPE_PRICE_PRO",        credits: 240 },
  mega:       { priceEnvKey: "STRIPE_PRICE_MEGA",       credits: 600 },
  ultra:      { priceEnvKey: "STRIPE_PRICE_ULTRA",      credits: 2600 },
  enterprise: { priceEnvKey: "STRIPE_PRICE_ENTERPRISE", credits: 5400 },
};

// Subscriptions no longer grant monthly credits — they apply a per-generation
// discount instead (see TIER_DISCOUNT). creditsPerMonth kept at 0 for back-compat
// with webhook code; discountPercent is the new source of value.
const SUBSCRIPTIONS: Record<string, { priceEnvKey: string; creditsPerMonth: number; discountPercent: number }> = {
  basic:            { priceEnvKey: "STRIPE_PRICE_SUB_BASIC",            creditsPerMonth: 0, discountPercent: 15 },
  premium:          { priceEnvKey: "STRIPE_PRICE_SUB_PREMIUM",          creditsPerMonth: 0, discountPercent: 30 },
  pro:              { priceEnvKey: "STRIPE_PRICE_SUB_PRO",              creditsPerMonth: 0, discountPercent: 50 },
  elite:            { priceEnvKey: "STRIPE_PRICE_SUB_ELITE",            creditsPerMonth: 0, discountPercent: 70 },
  "basic-yearly":   { priceEnvKey: "STRIPE_PRICE_SUB_BASIC_YEARLY",     creditsPerMonth: 0, discountPercent: 15 },
  "premium-yearly": { priceEnvKey: "STRIPE_PRICE_SUB_PREMIUM_YEARLY",   creditsPerMonth: 0, discountPercent: 30 },
  "pro-yearly":     { priceEnvKey: "STRIPE_PRICE_SUB_PRO_YEARLY",       creditsPerMonth: 0, discountPercent: 50 },
  "elite-yearly":   { priceEnvKey: "STRIPE_PRICE_SUB_ELITE_YEARLY",     creditsPerMonth: 0, discountPercent: 70 },
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

    // Require email verification before purchasing
    const [userRow] = await sql`SELECT email_verified FROM users WHERE id = ${auth.userId}`;
    if (!userRow?.email_verified) {
      return res.status(403).json({ error: "Please verify your email before purchasing credits." });
    }

    const body = req.body || {};

    // ── Post Unlock: one-time payment to unlock a locked feed post ──
    if (body.action === "post_unlock") {
      const { postId } = body;
      if (!postId) return res.status(400).json({ error: "postId required" });

      const [post] = await sql`SELECT id, user_id, lock_price_cents FROM feed_posts WHERE id = ${postId}::uuid`;
      if (!post) return res.status(404).json({ error: "Post not found" });
      if (post.lock_price_cents <= 0) return res.status(400).json({ error: "Post has no cash price" });
      if (post.user_id === auth.userId) return res.status(400).json({ error: "Cannot unlock own post" });

      // Check already unlocked
      const [already] = await sql`SELECT id FROM feed_unlocks WHERE post_id = ${postId}::uuid AND user_id = ${auth.userId}::uuid`.catch(() => [undefined]);
      if (already) return res.status(400).json({ error: "Already unlocked" });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: post.lock_price_cents,
            product_data: { name: `Unlock Post` },
          },
          quantity: 1,
        }],
        client_reference_id: auth.userId,
        metadata: {
          user_id: auth.userId,
          type: "post_unlock",
          post_id: postId,
          creator_id: post.user_id,
          amount_cents: String(post.lock_price_cents),
        },
        success_url: `${SITE_URL}/feed?checkout=success&unlocked=${postId}`,
        cancel_url: `${SITE_URL}/feed?checkout=cancelled`,
      });
      return res.status(200).json({ url: session.url });
    }

    // ── LoRA Unlock: one-time $30 payment ──
    if (body.action === "lora_unlock") {
      const priceId = process.env.STRIPE_PRICE_LORA_UNLOCK;
      if (!priceId) return res.status(500).json({ error: "LoRA unlock price not configured" });

      const [already] = await sql`SELECT lora_unlocked FROM users WHERE id = ${auth.userId}`;
      if (already?.lora_unlocked) {
        return res.status(400).json({ error: "LoRAs already unlocked" });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: auth.userId,
        metadata: { user_id: auth.userId, type: "lora_unlock" },
        success_url: `${SITE_URL}?checkout=success&lora=unlocked`,
        cancel_url: `${SITE_URL}?checkout=cancelled`,
      });
      return res.status(200).json({ url: session.url });
    }

    // ── Portal: redirect to Stripe Customer Portal ──
    if (body.action === "portal") {
      const rows = await sql`
        SELECT stripe_customer_id, email FROM users WHERE id = ${auth.userId}
      `;
      let customerId: string | null = rows[0]?.stripe_customer_id || null;

      // Legacy fallback: many grandfathered subscribers never had stripe_customer_id
      // persisted. Look them up by email so they can still reach the portal to cancel.
      if (!customerId && rows[0]?.email) {
        try {
          const list = await stripe.customers.list({ email: rows[0].email, limit: 5 });
          // Prefer customers with an active/past_due subscription.
          for (const c of list.data) {
            const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 5 });
            if (subs.data.some(s => ["active", "past_due", "trialing", "unpaid"].includes(s.status))) {
              customerId = c.id;
              break;
            }
          }
          if (!customerId && list.data[0]) customerId = list.data[0].id;
          if (customerId) {
            await sql`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${auth.userId}`;
            console.log(`[checkout] portal: recovered stripe_customer_id ${customerId} for user ${auth.userId} via email lookup`);
          }
        } catch (e: any) {
          console.warn("[checkout] portal email lookup failed:", e.message);
        }
      }

      if (!customerId) {
        return res.status(404).json({ error: "No Stripe customer on file. Email support@ to cancel." });
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
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
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: auth.userId,
        metadata: { user_id: auth.userId, tier: tierId, credits_per_month: String(tier.creditsPerMonth), discount_pct: String(tier.discountPercent) },
        subscription_data: {
          metadata: { user_id: auth.userId, tier: tierId, credits_per_month: String(tier.creditsPerMonth), discount_pct: String(tier.discountPercent) },
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
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: auth.userId,
      metadata: { user_id: auth.userId, package: packageId, credits: String(pkg.credits), type: "pack" },
      success_url: `${SITE_URL}?checkout=success`,
      cancel_url: `${SITE_URL}?checkout=cancelled`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    // Surface a useful message so support can diagnose without digging through logs.
    // Stripe errors expose `type`, `code`, `message` — all safe to return.
    const stripeType = err?.type || err?.raw?.type;
    const stripeCode = err?.code || err?.raw?.code;
    const message = err?.message || "Unknown error";
    console.error("[checkout]", { stripeType, stripeCode, message, stack: err?.stack });
    const friendly = stripeCode
      ? `Checkout failed (${stripeCode}): ${message}`
      : `Checkout failed: ${message}`;
    return res.status(500).json({
      error: friendly,
      detail: message,
      stripeType,
      stripeCode,
    });
  }
}

/**
 * /api/stripe-price-inspect — Admin tool: inspect Stripe price IDs and create
 * a test checkout session against an arbitrary price ID, before swapping the
 * env vars in production.
 *
 * POST { action: "inspect", priceIds: string[] }
 *   -> [{ id, currency, unit_amount, recurring, product: { id, name }, active, livemode, error? }]
 *
 * POST { action: "current" }
 *   -> Map<envKey, { value, info }> for all known STRIPE_PRICE_* env vars
 *
 * POST { action: "test-checkout", priceId, mode: "payment" | "subscription" }
 *   -> { url } — opens a one-off Stripe checkout against the pasted priceId.
 *
 * Admin-only (matches ADMIN_EMAIL pattern used elsewhere).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { applyCors } from "./_lib/cors";

// Keep this list in sync with checkout.ts. These are the env vars this app reads.
const KNOWN_ENV_KEYS = [
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_MEGA",
  "STRIPE_PRICE_ULTRA",
  "STRIPE_PRICE_ENTERPRISE",
  "STRIPE_PRICE_SUB_BASIC",
  "STRIPE_PRICE_SUB_PREMIUM",
  "STRIPE_PRICE_SUB_PRO",
  "STRIPE_PRICE_SUB_ELITE",
  "STRIPE_PRICE_SUB_BASIC_YEARLY",
  "STRIPE_PRICE_SUB_PREMIUM_YEARLY",
  "STRIPE_PRICE_SUB_PRO_YEARLY",
  "STRIPE_PRICE_SUB_ELITE_YEARLY",
] as const;

type PriceInfo = {
  id: string;
  active?: boolean;
  livemode?: boolean;
  currency?: string;
  unit_amount?: number | null;
  recurring?: { interval: string; interval_count: number } | null;
  product?: { id: string; name: string } | null;
  error?: string;
};

async function fetchPrice(stripe: Stripe, id: string): Promise<PriceInfo> {
  try {
    const p = await stripe.prices.retrieve(id, { expand: ["product"] });
    const product = p.product && typeof p.product === "object" && !("deleted" in p.product)
      ? { id: (p.product as Stripe.Product).id, name: (p.product as Stripe.Product).name }
      : null;
    return {
      id: p.id,
      active: p.active,
      livemode: p.livemode,
      currency: p.currency,
      unit_amount: p.unit_amount,
      recurring: p.recurring ? { interval: p.recurring.interval, interval_count: p.recurring.interval_count } : null,
      product,
    };
  } catch (e: any) {
    return { id, error: e?.message || "Unknown error" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (auth.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const body = req.body || {};
  const action = body.action;

  try {
    if (action === "current") {
      const out: Record<string, { value: string | null; info: PriceInfo | null }> = {};
      await Promise.all(
        KNOWN_ENV_KEYS.map(async (k) => {
          const v = process.env[k] || null;
          out[k] = { value: v, info: v ? await fetchPrice(stripe, v) : null };
        })
      );
      return res.status(200).json({ envKeys: KNOWN_ENV_KEYS, current: out });
    }

    if (action === "inspect") {
      const ids: string[] = Array.isArray(body.priceIds) ? body.priceIds.filter(Boolean) : [];
      if (ids.length === 0) return res.status(400).json({ error: "priceIds required" });
      if (ids.length > 30) return res.status(400).json({ error: "Too many ids" });
      const results = await Promise.all(ids.map((id) => fetchPrice(stripe, id)));
      return res.status(200).json({ results });
    }

    if (action === "test-checkout") {
      const priceId: string = body.priceId;
      const mode: "payment" | "subscription" = body.mode === "subscription" ? "subscription" : "payment";
      if (!priceId) return res.status(400).json({ error: "priceId required" });

      const SITE_URL = process.env.SITE_URL || `https://${req.headers.host}`;
      const session = await stripe.checkout.sessions.create({
        mode,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${SITE_URL}/admin/stripe-prices?test=success`,
        cancel_url: `${SITE_URL}/admin/stripe-prices?test=cancel`,
        metadata: { admin_test: "true", admin_user: auth.userId },
      });
      return res.status(200).json({ url: session.url });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e: any) {
    console.error("[stripe-price-inspect]", e?.message);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
}

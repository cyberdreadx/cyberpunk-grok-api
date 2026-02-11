/**
 * /api/webhook — Stripe webhook handler.
 * Handles: checkout.session.completed, invoice.paid, customer.subscription.deleted
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";

// Vercel needs raw body for signature verification
export const config = { api: { bodyParser: false } };

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const TIER_CREDITS: Record<string, number> = {
  basic: 150,
  premium: 500,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
    if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
      return res.status(500).json({ error: "Stripe not configured" });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) return res.status(400).json({ error: "No Stripe signature" });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("Webhook signature failed:", err.message);
      return res.status(400).json({ error: "Invalid signature" });
    }

    const sql = getDb();

    // ── checkout.session.completed: one-time pack purchase ──
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        return res.status(200).json({ received: true }); // handled by invoice.paid
      }

      const userId = session.client_reference_id || session.metadata?.user_id;
      const credits = parseInt(session.metadata?.credits || "0", 10);
      const packageId = session.metadata?.package || "unknown";

      if (!userId || credits <= 0) {
        console.error("Webhook: missing metadata", { userId, credits });
        return res.status(200).json({ received: true });
      }

      await sql`SELECT add_pack_credits(${userId}::uuid, ${credits})`;
      await sql`
        INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type)
        VALUES (${userId}::uuid, ${credits}, ${session.amount_total || 0}, ${session.id}, ${packageId}, 'pack')
      `;
      console.log(`Added ${credits} pack credits to ${userId}`);
    }

    // ── invoice.paid: subscription renewal → reset sub_credits ──
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as any).subscription as string | null;
      if (!subscriptionId) return res.status(200).json({ received: true });

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const userId = subscription.metadata?.user_id;
      const tier = subscription.metadata?.tier;
      const creditsPerMonth = parseInt(subscription.metadata?.credits_per_month || "0", 10);

      if (!userId || !tier || creditsPerMonth <= 0) {
        console.error("invoice.paid: missing metadata", { userId, tier, creditsPerMonth });
        return res.status(200).json({ received: true });
      }

      const renewsAt = new Date((subscription as any).current_period_end * 1000).toISOString();

      await sql`SELECT reset_sub_credits(${userId}::uuid, ${creditsPerMonth}, ${tier}, ${renewsAt}::timestamptz)`;

      if (invoice.customer) {
        await sql`UPDATE users SET stripe_customer_id = ${invoice.customer as string} WHERE id = ${userId}::uuid`;
      }

      await sql`
        INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type)
        VALUES (${userId}::uuid, ${creditsPerMonth}, ${invoice.amount_paid || 0}, ${invoice.id}, ${tier}, 'subscription')
      `;
      console.log(`Reset sub_credits to ${creditsPerMonth} for ${userId} (${tier})`);
    }

    // ── customer.subscription.deleted ──
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      if (userId) {
        await sql`SELECT clear_subscription(${userId}::uuid)`;
        console.log(`Subscription cancelled for ${userId}`);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[webhook]", err.message);
    return res.status(500).json({ error: err.message });
  }
}

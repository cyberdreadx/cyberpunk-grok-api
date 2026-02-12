/**
 * /api/webhook — Stripe webhook handler.
 * Handles: checkout.session.completed, invoice.paid, customer.subscription.deleted
 * Includes idempotency checks to prevent double-processing on retries.
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
  "basic-yearly": 150,
  "premium-yearly": 500,
};

/**
 * Check if an event has already been processed. If not, mark it as processed.
 * Returns true if this is a new event, false if already processed.
 */
async function markEventProcessed(sql: any, eventId: string): Promise<boolean> {
  try {
    await sql`
      INSERT INTO processed_events (event_id, processed_at)
      VALUES (${eventId}, now())
    `;
    return true; // New event, successfully inserted
  } catch (err: any) {
    // Unique constraint violation = already processed
    if (err.message?.includes("unique") || err.code === "23505") {
      return false;
    }
    throw err; // Unexpected error
  }
}

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

    // Idempotency check: skip if we've already processed this event
    const isNew = await markEventProcessed(sql, event.id);
    if (!isNew) {
      console.log(`[webhook] Skipping duplicate event: ${event.id}`);
      return res.status(200).json({ received: true, duplicate: true });
    }

    // ── checkout.session.completed: pack purchase + subscription fallback grant ──
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        // Only grant fallback credits when Stripe marks checkout as paid.
        if (session.payment_status !== "paid") {
          console.log("[webhook] subscription checkout completed but not paid yet:", session.id, session.payment_status);
          return res.status(200).json({ received: true });
        }

        // Primary subscription handling is invoice.paid, but this fallback grants initial
        // credits in case invoice events are delayed/missed.
        const metadata = session.metadata || {};
        let userId = session.client_reference_id || metadata.user_id || "";
        let tier = metadata.tier || "";
        let creditsPerMonth = parseInt(metadata.credits_per_month || "0", 10);
        let renewsAt: string | null = null;

        const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            userId = userId || subscription.metadata?.user_id || "";
            tier = tier || subscription.metadata?.tier || "";
            const subMetaCredits = parseInt(subscription.metadata?.credits_per_month || "0", 10);
            if (subMetaCredits > 0) creditsPerMonth = subMetaCredits;
            const currentPeriodEnd = (subscription as any).current_period_end as number | undefined;
            if (currentPeriodEnd) {
              renewsAt = new Date(currentPeriodEnd * 1000).toISOString();
            }
          } catch (subErr: any) {
            console.warn("[webhook] subscription fallback lookup failed:", subErr.message);
          }
        }

        if (creditsPerMonth <= 0 && tier) {
          creditsPerMonth = TIER_CREDITS[tier] || 0;
        }
        if (!userId || !tier || creditsPerMonth <= 0) {
          console.error("checkout.session.completed(subscription): missing metadata", {
            userId,
            tier,
            creditsPerMonth,
            sessionId: session.id,
          });
          return res.status(200).json({ received: true });
        }

        await sql`SELECT reset_sub_credits(${userId}::uuid, ${creditsPerMonth}, ${tier}, ${renewsAt}::timestamptz)`;
        if (session.customer) {
          await sql`UPDATE users SET stripe_customer_id = ${session.customer as string} WHERE id = ${userId}::uuid`;
        }
        await sql`
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type)
          VALUES (${userId}::uuid, ${creditsPerMonth}, ${session.amount_total || 0}, ${session.id}, ${tier}, 'subscription')
        `;
        console.log(`Fallback: set sub_credits to ${creditsPerMonth} for ${userId} (${tier})`);
        return res.status(200).json({ received: true });
      }

      const userId = session.client_reference_id || session.metadata?.user_id;
      const credits = parseInt(session.metadata?.credits || "0", 10);
      const packageId = session.metadata?.package || "unknown";

      if (!userId || credits <= 0) {
        console.error("Webhook: missing metadata", { userId, credits });
        return res.status(200).json({ received: true });
      }

      // Atomic + idempotent: insert transaction first, then add credits only if inserted.
      const rows = await sql`
        WITH ins AS (
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type)
          VALUES (${userId}::uuid, ${credits}, ${session.amount_total || 0}, ${session.id}, ${packageId}, 'pack')
          ON CONFLICT DO NOTHING
          RETURNING user_id, credits
        ), upd AS (
          UPDATE users
          SET pack_credits = pack_credits + (SELECT credits FROM ins),
              updated_at = now()
          WHERE id = ${userId}::uuid
            AND EXISTS (SELECT 1 FROM ins)
          RETURNING id
        )
        SELECT EXISTS(SELECT 1 FROM ins) AS inserted
      `;
      const inserted = !!rows?.[0]?.inserted;
      if (inserted) {
        console.log(`Added ${credits} pack credits to ${userId}`);
      } else {
        console.log(`[webhook] Duplicate pack transaction skipped for session ${session.id}`);
      }
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
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

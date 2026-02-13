/**
 * /api/webhook — Stripe webhook handler.
 * Handles: checkout.session.completed, invoice.paid, customer.subscription.updated, customer.subscription.deleted
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

/**
 * Detect payment method from a checkout session or invoice.
 * Returns 'paypal', 'card', 'apple_pay', 'google_pay', 'link', etc.
 */
async function detectPaymentMethod(stripe: Stripe, session: any): Promise<string> {
  try {
    // checkout.session has payment_method_types array
    const types = session.payment_method_types as string[] | undefined;
    if (types?.length === 1) return types[0]; // e.g. "paypal", "card"

    // Try to get the actual payment method from the payment intent
    const piId = session.payment_intent as string | undefined;
    if (piId) {
      const pi = await stripe.paymentIntents.retrieve(piId);
      const pmId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
      if (pmId) {
        const pm = await stripe.paymentMethods.retrieve(pmId);
        if (pm.type === "card" && pm.card?.wallet?.type) {
          return pm.card.wallet.type; // 'apple_pay', 'google_pay', 'link'
        }
        return pm.type; // 'card', 'paypal', 'cashapp', etc.
      }
    }

    // Fallback for invoices: check the charge
    const chargeId = session.charge as string | undefined;
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId);
      const pmDetails = (charge as any).payment_method_details;
      if (pmDetails?.type) return pmDetails.type;
    }
  } catch (err: any) {
    console.warn("[webhook] detectPaymentMethod failed:", err.message);
  }
  return "unknown";
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

    // ── checkout.session.completed OR async_payment_succeeded ──
    // PayPal (and other async methods) fire "completed" with payment_status="unpaid",
    // then "async_payment_succeeded" when money actually clears.
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;

      // For async payment methods (PayPal): skip "completed" if not paid yet —
      // credits will be granted when "async_payment_succeeded" fires.
      if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
        console.log("[webhook] checkout completed but payment pending (async method):", session.id, session.payment_status);
        return res.status(200).json({ received: true, pending: true });
      }

      if (session.mode === "subscription") {

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
        const subPayMethod = await detectPaymentMethod(stripe, session);
        await sql`
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
          VALUES (${userId}::uuid, ${creditsPerMonth}, ${session.amount_total || 0}, ${session.id}, ${tier}, 'subscription', ${subPayMethod})
        `;
        console.log(`Fallback: set sub_credits to ${creditsPerMonth} for ${userId} (${tier}) via ${subPayMethod}`);
        return res.status(200).json({ received: true });
      }

      const userId = session.client_reference_id || session.metadata?.user_id;
      const credits = parseInt(session.metadata?.credits || "0", 10);
      const packageId = session.metadata?.package || "unknown";

      if (!userId || credits <= 0) {
        console.error("Webhook: missing metadata", { userId, credits });
        return res.status(200).json({ received: true });
      }

      // Detect payment method (card, paypal, apple_pay, etc.)
      const paymentMethod = await detectPaymentMethod(stripe, session);

      // Atomic + idempotent: insert transaction first, then add credits only if inserted.
      const rows = await sql`
        WITH ins AS (
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
          VALUES (${userId}::uuid, ${credits}, ${session.amount_total || 0}, ${session.id}, ${packageId}, 'pack', ${paymentMethod})
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

      // Extract metadata from the invoice payload directly (avoids extra API call
      // that can fail with restricted keys). Metadata is in multiple places:
      const subDetails = (invoice as any).parent?.subscription_details?.metadata
        || (invoice as any).subscription_details?.metadata
        || {};
      const lineItemMeta = (invoice as any).lines?.data?.[0]?.metadata || {};
      const meta = {
        user_id: subDetails.user_id || lineItemMeta.user_id || "",
        tier: subDetails.tier || lineItemMeta.tier || "",
        credits_per_month: subDetails.credits_per_month || lineItemMeta.credits_per_month || "0",
      };

      // Fallback: if metadata not in invoice, retrieve subscription from Stripe
      if (!meta.user_id || !meta.tier) {
        try {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          meta.user_id = meta.user_id || subscription.metadata?.user_id || "";
          meta.tier = meta.tier || subscription.metadata?.tier || "";
          meta.credits_per_month = meta.credits_per_month || subscription.metadata?.credits_per_month || "0";
        } catch (subErr: any) {
          console.warn("[webhook] subscription retrieve failed:", subErr.message);
        }
      }

      const userId = meta.user_id;
      const tier = meta.tier;
      let creditsPerMonth = parseInt(meta.credits_per_month, 10);
      if (creditsPerMonth <= 0 && tier) {
        creditsPerMonth = TIER_CREDITS[tier] || 0;
      }

      if (!userId || !tier || creditsPerMonth <= 0) {
        console.error("invoice.paid: missing metadata", { userId, tier, creditsPerMonth, subDetails, lineItemMeta });
        return res.status(200).json({ received: true });
      }

      // Compute renewal date from line item period or current time + 30 days
      const periodEnd = (invoice as any).lines?.data?.[0]?.period?.end;
      const renewsAt = periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await sql`SELECT reset_sub_credits(${userId}::uuid, ${creditsPerMonth}, ${tier}, ${renewsAt}::timestamptz)`;

      if (invoice.customer) {
        await sql`UPDATE users SET stripe_customer_id = ${invoice.customer as string} WHERE id = ${userId}::uuid`;
      }

      const invoicePayMethod = await detectPaymentMethod(stripe, invoice);
      await sql`
        INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
        VALUES (${userId}::uuid, ${creditsPerMonth}, ${invoice.amount_paid || 0}, ${invoice.id}, ${tier}, 'subscription', ${invoicePayMethod})
      `;
      console.log(`Reset sub_credits to ${creditsPerMonth} for ${userId} (${tier}) via ${invoicePayMethod}`);
    }

    // ── customer.subscription.updated ──
    // Fires when user cancels in portal (cancel_at_period_end = true)
    // or reactivates before the period ends (cancel_at_period_end = false)
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      if (userId) {
        if (subscription.cancel_at_period_end) {
          // User cancelled — record when it will end
          const cancelAt = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null;
          await sql`
            UPDATE users
            SET subscription_cancel_at = ${cancelAt}::timestamptz,
                updated_at = now()
            WHERE id = ${userId}::uuid
          `;
          console.log(`Subscription pending cancellation for ${userId}, ends at ${cancelAt}`);
        } else {
          // User reactivated — clear the cancel_at flag
          await sql`
            UPDATE users
            SET subscription_cancel_at = NULL,
                updated_at = now()
            WHERE id = ${userId}::uuid
          `;
          console.log(`Subscription reactivated for ${userId}`);
        }
      }
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

    // ── Referral purchase reward ──
    // After any successful purchase, check if the buyer was referred and hasn't
    // triggered the purchase reward yet. Grant 10 credits to referrer + 5 bonus to referee.
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "invoice.paid"
    ) {
      try {
        // Determine the purchasing user's ID
        let buyerUserId: string | null = null;
        if (event.type === "checkout.session.completed") {
          const s = event.data.object as Stripe.Checkout.Session;
          buyerUserId = s.client_reference_id || s.metadata?.user_id || null;
        } else if (event.type === "invoice.paid") {
          const inv = event.data.object as Stripe.Invoice;
          const subId = (inv as any).subscription as string | null;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            buyerUserId = sub.metadata?.user_id || null;
          }
        }

        if (buyerUserId) {
          // Find an unrewarded referral for this buyer
          const [ref] = await sql`
            SELECT r.id, r.referrer_id
            FROM referrals r
            WHERE r.referee_id = ${buyerUserId}::uuid
              AND r.referee_purchased = false
          `;

          if (ref) {
            // Check referrer hasn't exceeded 50 lifetime rewarded referrals
            const [cap] = await sql`
              SELECT COUNT(*)::int AS rewarded
              FROM referrals
              WHERE referrer_id = ${ref.referrer_id}::uuid AND referrer_rewarded = true
            `;

            if ((cap?.rewarded || 0) < 50) {
              // Grant 10 credits to referrer
              await sql`SELECT add_pack_credits(${ref.referrer_id}::uuid, 10)`;
              // Grant 5 bonus credits to referee (buyer)
              await sql`SELECT add_pack_credits(${buyerUserId}::uuid, 5)`;
              // Mark referral as fully rewarded
              await sql`
                UPDATE referrals
                SET referee_purchased = true,
                    referrer_rewarded = true,
                    referee_purchase_reward = true
                WHERE id = ${ref.id}::uuid
              `;
              console.log(`[referral] Purchase reward: +10 to referrer ${ref.referrer_id}, +5 bonus to buyer ${buyerUserId}`);
            } else {
              // Referrer hit cap — still mark purchase but don't grant referrer credits
              await sql`
                UPDATE referrals
                SET referee_purchased = true, referee_purchase_reward = true
                WHERE id = ${ref.id}::uuid
              `;
              // Still give the buyer their 5 bonus
              await sql`SELECT add_pack_credits(${buyerUserId}::uuid, 5)`;
              console.log(`[referral] Referrer ${ref.referrer_id} hit 50-cap, but buyer ${buyerUserId} still gets +5 bonus`);
            }
          }
        }
      } catch (refErr: any) {
        // Non-critical — don't fail the webhook if referral logic errors
        console.error("[referral] purchase reward error:", refErr.message);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[webhook]", err.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

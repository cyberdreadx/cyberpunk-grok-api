/**
 * /api/webhook — Stripe webhook handler.
 * Handles: checkout.session.completed, invoice.paid, customer.subscription.updated, customer.subscription.deleted
 * Includes idempotency checks to prevent double-processing on retries.
 *
 * IMPORTANT: Subscription credits + transaction logging are handled SOLELY by invoice.paid.
 * checkout.session.completed for subscriptions only sets stripe_customer_id.
 * This prevents double transaction entries (both events fire for new subscriptions).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import {
  sendVerificationPaymentReceiptEmail,
  sendVerificationApprovedEmail,
} from "./_lib/email";
import {
  TIER_DISCOUNT_PCT,
  getPriceIdTierMap,
  extractSubPriceIds,
  isLegacySubPrice,
  computeLegacyCreditGrant,
  computeSubCreditGrant,
  parseCreditsPerMonthFromMeta,
  getInvoiceSubscriptionId,
} from "./_lib/stripe-sub-prices";

// Vercel needs raw body for signature verification
export const config = { api: { bodyParser: false } };

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  // Self-hosted (Express): express.raw() has already consumed the stream and
  // placed the raw bytes on req.body, so the stream below would be empty.
  // Use that buffer directly. On Vercel (bodyParser:false) req.body is unset,
  // so we fall through and read the stream as before.
  const pre = (req as unknown as { body?: unknown }).body;
  if (Buffer.isBuffer(pre)) return pre;
  if (typeof pre === "string") return Buffer.from(pre);
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

async function resolveUserIdFromInvoice(
  sql: any,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  metaUserId: string
): Promise<string | null> {
  if (metaUserId) return metaUserId;

  if (invoice.customer) {
    const [u] = await sql`
      SELECT id FROM users WHERE stripe_customer_id = ${invoice.customer as string} LIMIT 1
    `.catch(() => [null]);
    if (u?.id) {
      console.log(`[webhook] invoice.paid: resolved user ${u.id} via stripe_customer_id`);
      return u.id;
    }
  }

  let email = (invoice as any).customer_email as string | undefined;
  if (!email && invoice.customer) {
    try {
      const c = await stripe.customers.retrieve(invoice.customer as string);
      if (!(c as any).deleted) email = (c as Stripe.Customer).email || undefined;
    } catch {
      // ignore
    }
  }
  if (email) {
    const [u] = await sql`
      SELECT id FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
    `.catch(() => [null]);
    if (u?.id) {
      console.log(`[webhook] invoice.paid: resolved user ${u.id} via email ${email}`);
      return u.id;
    }
  }

  return null;
}

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

      // ── Post unlock (Stripe payment) ──
      if (session.metadata?.type === "post_unlock") {
        const userId = session.client_reference_id || session.metadata?.user_id;
        const postId = session.metadata?.post_id;
        const creatorId = session.metadata?.creator_id;
        const amountCents = parseInt(session.metadata?.amount_cents || "0", 10);
        if (userId && postId) {
          await sql`
            INSERT INTO feed_unlocks (post_id, user_id, cents_paid, unlock_method, stripe_session_id)
            VALUES (${postId}::uuid, ${userId}::uuid, ${amountCents}, 'stripe', ${session.id})
            ON CONFLICT (post_id, user_id) DO NOTHING
          `;
          // Revenue split: 75% creator, 20% platform, 5% charity
          // Creator gets 75% as cash balance (real money)
          if (creatorId && amountCents > 0) {
            const creatorCents = Math.floor(amountCents * 0.75);
            const creatorCredits = Math.floor(creatorCents / 10);
            if (creatorCents > 0) {
              await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cash_balance_cents INT NOT NULL DEFAULT 0`.catch(() => {});
              await sql`UPDATE users SET cash_balance_cents = COALESCE(cash_balance_cents, 0) + ${creatorCents}, pack_credits = pack_credits + ${creatorCredits}, updated_at = now() WHERE id = ${creatorId}::uuid`;
            }
          }
          console.log(`[webhook] Post ${postId} unlocked by ${userId} via Stripe ($${(amountCents / 100).toFixed(2)}) — 75% creator / 20% platform / 5% charity`);
        }
        return res.status(200).json({ received: true });
      }

      // ── LoRA unlock (one-time purchase) ──
      if (session.metadata?.type === "lora_unlock") {
        const userId = session.client_reference_id || session.metadata?.user_id;
        if (userId) {
          await sql`UPDATE users SET lora_unlocked = true, updated_at = now() WHERE id = ${userId}::uuid`;
          await sql`
            INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
            VALUES (${userId}::uuid, 0, ${session.amount_total || 0}, ${session.id}, 'lora_unlock', 'pack', ${await detectPaymentMethod(stripe, session)})
            ON CONFLICT DO NOTHING
          `;
          console.log(`[webhook] LoRA unlock granted for ${userId}`);
        }
        return res.status(200).json({ received: true });
      }

      if (session.mode === "subscription") {

        // NOTE: Do NOT grant credits or log transactions here!
        // invoice.paid is the sole handler for subscription credits + transaction logging.
        // Previously this "fallback" ran alongside invoice.paid, causing double transaction
        // entries and inflated revenue reporting.
        //
        // We only use checkout.session.completed for subscriptions to set stripe_customer_id
        // early (invoice.paid also sets it, but this ensures it's captured immediately).
        const metadata = session.metadata || {};
        const userId = session.client_reference_id || metadata.user_id || "";

        if (userId && session.customer) {
          await sql`UPDATE users SET stripe_customer_id = ${session.customer as string} WHERE id = ${userId}::uuid`;
          console.log(`[webhook] checkout.session.completed(subscription): set stripe_customer_id for ${userId}`);
        }
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

      // Subscriber bonus: if buyer has an active discount, grant equivalent
      // bonus credits so the in-app pack price effectively matches the discount.
      // bonus = credits * pct / (100 - pct)  (e.g. 30% sub → +43%; 50% sub → +100%)
      const [subRow] = await sql`SELECT COALESCE(subscription_discount_pct, 0)::int AS pct FROM users WHERE id = ${userId}::uuid`.catch(() => [{ pct: 0 }]);
      const subPct = Math.max(0, Math.min(95, subRow?.pct ?? 0));
      const bonusCredits = subPct > 0 ? Math.floor((credits * subPct) / (100 - subPct)) : 0;
      const totalCreditsToGrant = credits + bonusCredits;

      // Atomic + idempotent: insert transaction first, then add credits only if inserted.
      const rows = await sql`
        WITH ins AS (
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
          VALUES (${userId}::uuid, ${totalCreditsToGrant}, ${session.amount_total || 0}, ${session.id}, ${packageId}, 'pack', ${paymentMethod})
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
        console.log(`Added ${totalCreditsToGrant} pack credits to ${userId} (base ${credits} + ${bonusCredits} subscriber bonus @ ${subPct}%)`);
      } else {
        console.log(`[webhook] Duplicate pack transaction skipped for session ${session.id}`);
      }

      // Always persist stripe_customer_id on pack purchases so the posting gate
      // (canPost / hasPurchased) recognizes the user as a paying customer.
      // Without this, users who buy credit packs get "Failed to post story".
      if (session.customer) {
        await sql`
          UPDATE users
          SET stripe_customer_id = ${session.customer as string}
          WHERE id = ${userId}::uuid AND stripe_customer_id IS NULL
        `;
      }
    }

    // ── invoice.paid: subscription renewal/start → activate per-generation discount ──
    // (No more bonus credits — that's the whole point: stops cancel→resubscribe farming.)
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);
      if (!subscriptionId) return res.status(200).json({ received: true });

      const subDetails = (invoice as any).parent?.subscription_details?.metadata
        || (invoice as any).subscription_details?.metadata
        || {};
      const lineItemMeta = (invoice as any).lines?.data?.[0]?.metadata || {};
      const meta = {
        user_id: subDetails.user_id || lineItemMeta.user_id || "",
        tier: subDetails.tier || lineItemMeta.tier || "",
        discount_pct: subDetails.discount_pct || lineItemMeta.discount_pct || "",
      };

      // Always pull the live subscription so we have customer + price IDs to fall back on.
      let subscription: Stripe.Subscription | null = null;
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
        meta.user_id = meta.user_id || subscription.metadata?.user_id || "";
        meta.tier = meta.tier || subscription.metadata?.tier || "";
        meta.discount_pct = meta.discount_pct || subscription.metadata?.discount_pct || "";
      } catch (subErr: any) {
        console.warn("[webhook] subscription retrieve failed:", subErr.message);
      }

      // Fallback 1: resolve tier from the price ID on the invoice line OR subscription item.
      // This rescues legacy customers whose subscription was created BEFORE we started writing
      // `tier` into metadata, or who are on an old price ID that has since been swapped.
      let resolvedTier = meta.tier;
      const priceMap = getPriceIdTierMap();
      const candidatePriceIds = extractSubPriceIds(invoice, subscription);
      if (!resolvedTier || !TIER_DISCOUNT_PCT[resolvedTier]) {
        for (const pid of candidatePriceIds) {
          if (priceMap[pid]) { resolvedTier = priceMap[pid]; break; }
        }
        if (resolvedTier) {
          console.log(`[webhook] invoice.paid: resolved tier '${resolvedTier}' via price ID fallback (candidates: ${candidatePriceIds.join(",")})`);
        }
      }

      // Current (v3) subs grant monthly BONUS CREDITS instead of a per-gen discount.
      // Legacy (pre-v3 price IDs) keep their credit grant via computeLegacyCreditGrant.
      const isLegacyPrice = isLegacySubPrice(candidatePriceIds);
      const creditsPerMonthMeta = parseCreditsPerMonthFromMeta(
        subscription?.metadata,
        subDetails,
        lineItemMeta,
        (invoice as any).lines?.data?.[0]?.metadata
      );

      const userId = await resolveUserIdFromInvoice(sql, stripe, invoice, meta.user_id);
      const tier = resolvedTier;
      const amountPaidCents = invoice.amount_paid || 0;

      // Credits to grant on this invoice. v3 plans use the tier→credits table
      // (yearly = 12× monthly); legacy grandfathered plans use the old per-$ grant.
      let creditGrant = 0;
      if (!isLegacyPrice && amountPaidCents > 0) {
        creditGrant = computeSubCreditGrant(tier);
      } else if (isLegacyPrice) {
        creditGrant = computeLegacyCreditGrant({
          priceIds: candidatePriceIds,
          amountPaidCents,
          creditsPerMonthMeta: creditsPerMonthMeta || undefined,
        });
      }

      // A paid subscription invoice must result in a credit grant. If we can't
      // resolve the user or compute credits, log for manual reconciliation.
      if (!userId || creditGrant <= 0) {
        console.error("[webhook] invoice.paid UNRESOLVED — manual reconciliation needed", {
          invoiceId: invoice.id,
          subscriptionId,
          customerId: invoice.customer,
          amountPaidCents,
          userId, tier, creditGrant, isLegacyPrice,
          candidatePriceIds,
          creditsPerMonthMeta,
          subDetails, lineItemMeta,
          subMetadata: subscription?.metadata,
        });
        return res.status(200).json({ received: true, unresolved: true });
      }

      const periodEnd = (invoice as any).lines?.data?.[0]?.period?.end;
      const renewsAt = periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Record the active tier + renewal, and CLEAR any per-gen discount — existing
      // subscribers flip from the old discount model to credits on this renewal.
      if (tier) {
        await sql`
          UPDATE users SET
            subscription_tier = ${tier},
            subscription_renews_at = ${renewsAt}::timestamptz,
            subscription_cancel_at = NULL,
            subscription_discount_pct = 0,
            updated_at = now()
          WHERE id = ${userId}::uuid
        `;
      } else {
        // Legacy with no resolvable tier — still record renewal + clear discount.
        await sql`
          UPDATE users SET
            subscription_renews_at = ${renewsAt}::timestamptz,
            subscription_cancel_at = NULL,
            subscription_discount_pct = 0,
            updated_at = now()
          WHERE id = ${userId}::uuid
        `;
      }

      if (invoice.customer) {
        await sql`UPDATE users SET stripe_customer_id = ${invoice.customer as string} WHERE id = ${userId}::uuid`;
      }

      // Atomic + idempotent: insert this invoice's transaction first; grant credits
      // only when it's a NEW row, so Stripe retries / redeliveries can't double-grant.
      const invoicePayMethod = await detectPaymentMethod(stripe, invoice);
      const insRows = await sql`
        INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
        VALUES (${userId}::uuid, ${creditGrant}, ${amountPaidCents}, ${invoice.id}, ${tier || 'legacy'}, 'subscription', ${invoicePayMethod})
        ON CONFLICT (stripe_session_id) DO NOTHING
        RETURNING id
      `;
      if (insRows.length > 0) {
        try {
          await sql`SELECT add_pack_credits(${userId}::uuid, ${creditGrant})`;
          console.log(`[webhook] invoice.paid: granted ${creditGrant} credits to ${userId} (tier=${tier || 'legacy'}, paid=${amountPaidCents}c) via ${invoicePayMethod}`);
        } catch (e: any) {
          console.error("[webhook] sub credit grant failed:", e.message);
        }
      } else {
        console.log(`[webhook] invoice.paid: duplicate invoice ${invoice.id} skipped (no double-grant)`);
      }
    }

    // ── customer.subscription.updated ──
    // Fires when user cancels/reactivates in Stripe portal.
    // Stripe has TWO cancellation signals:
    //   1. cancel_at_period_end = true → cancels at end of billing period
    //   2. cancel_at (timestamp) → cancels at a specific date
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      if (userId) {
        const isCancelling = subscription.cancel_at_period_end || !!subscription.cancel_at;

        if (isCancelling) {
          // User cancelled — determine when it will end
          const cancelAt = subscription.cancel_at
            ? new Date(subscription.cancel_at * 1000).toISOString()
            : (subscription as any).current_period_end
              ? new Date((subscription as any).current_period_end * 1000).toISOString()
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
      // Verification subs are handled separately below — never let them clear a plan.
      // And only clear the user's plan if they have NO OTHER active subscription, so
      // canceling an old/superseded sub doesn't wipe a still-active one (the bug that
      // un-subbed users who churned between tiers).
      if (userId && subscription.metadata?.type !== "creator_verification") {
        let otherActive: Stripe.Subscription | null = null;
        try {
          const customerId = typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
          if (customerId) {
            const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 10 });
            otherActive = subs.data.find((s) => s.id !== subscription.id) || null;
          }
        } catch (e: any) {
          console.warn("[webhook] sub.deleted active-check failed:", e?.message);
        }
        if (otherActive) {
          console.log(`[webhook] sub ${subscription.id} deleted but user ${userId} still has active sub ${otherActive.id} — NOT clearing plan`);
        } else {
          await sql`SELECT clear_subscription(${userId}::uuid)`;
          console.log(`Subscription cancelled for ${userId}`);
        }
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
          const subId = getInvoiceSubscriptionId(inv);
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            buyerUserId = sub.metadata?.user_id || null;
          }
        }

        if (buyerUserId) {
          // Atomically claim the referral row to avoid double-rewards on webhook retries
          const [ref] = await sql`
            UPDATE referrals
            SET referee_purchased = true, referee_purchase_reward = true
            WHERE referee_id = ${buyerUserId}::uuid
              AND referee_purchased = false
            RETURNING id, referrer_id
          `;

          if (ref) {
            // Check referrer hasn't exceeded 50 lifetime rewarded referrals
            const [cap] = await sql`
              SELECT COUNT(*)::int AS rewarded
              FROM referrals
              WHERE referrer_id = ${ref.referrer_id}::uuid AND referrer_rewarded = true
            `;

            if ((cap?.rewarded || 0) < 50) {
              await sql`SELECT add_pack_credits(${ref.referrer_id}::uuid, 10)`;
              await sql`SELECT add_pack_credits(${buyerUserId}::uuid, 5)`;
              await sql`
                UPDATE referrals
                SET referrer_rewarded = true
                WHERE id = ${ref.id}::uuid
              `;
              console.log(`[referral] Purchase reward: +10 to referrer ${ref.referrer_id}, +5 bonus to buyer ${buyerUserId}`);
            } else {
              console.log(`[referral] Referrer ${ref.referrer_id} hit 50-referral cap, purchase marked but no credits granted`);
              // Still give the buyer their 5 bonus
              await sql`SELECT add_pack_credits(${buyerUserId}::uuid, 5)`;
              console.log(`[referral] Referrer ${ref.referrer_id} hit 50-cap, but buyer ${buyerUserId} still gets +5 bonus`);
            }
          }
        }

        // ── Referral FREE MONTH reward (subscription path only) ──
        // When a referred user pays their first sub invoice, the referrer earns
        // a free month: applied as a Stripe customer balance credit (negative
        // amount = credit toward their next invoice) and a counter for the UI.
        if (buyerUserId && event.type === "invoice.paid") {
          const inv = event.data.object as Stripe.Invoice;
          const subId = getInvoiceSubscriptionId(inv);
          if (subId) {
            const [refSub] = await sql`
              UPDATE referrals
              SET referee_subscribed = true, referrer_free_month_granted = true
              WHERE referee_id = ${buyerUserId}::uuid
                AND referee_subscribed = false
              RETURNING id, referrer_id
            `;
            if (refSub) {
              await sql`
                UPDATE users SET free_months_earned = COALESCE(free_months_earned, 0) + 1
                WHERE id = ${refSub.referrer_id}::uuid
              `;
              // Apply Stripe balance credit if referrer has a customer record.
              try {
                const [referrer] = await sql`
                  SELECT stripe_customer_id FROM users WHERE id = ${refSub.referrer_id}::uuid
                `;
                if (referrer?.stripe_customer_id && inv.amount_paid > 0) {
                  await stripe.customers.createBalanceTransaction(
                    referrer.stripe_customer_id,
                    {
                      amount: -Math.abs(inv.amount_paid),
                      currency: inv.currency || "usd",
                      description: `Referral free month — referee ${buyerUserId}`,
                    }
                  );
                  console.log(`[referral] Free month: credited ${inv.amount_paid} to referrer ${refSub.referrer_id}`);
                } else {
                  console.log(`[referral] Free month earned by ${refSub.referrer_id} — no stripe_customer_id yet, counter incremented only`);
                }
              } catch (balErr: any) {
                console.error("[referral] balance credit failed:", balErr.message);
              }
            }
          }
        }
      } catch (refErr: any) {
        // Non-critical — don't fail the webhook if referral logic errors
        console.error("[referral] purchase reward error:", refErr.message);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // CREATOR VERIFICATION (Stripe Identity + monthly verification sub)
    // ════════════════════════════════════════════════════════════════════

    // Verification checkout completed → mark one-time fee paid + store sub id.
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.type === "creator_verification_start" && s.payment_status !== "unpaid") {
        const userId = s.client_reference_id || s.metadata?.user_id;
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
        if (userId) {
          await sql`
            UPDATE users
            SET verification_onetime_paid = true,
                verification_subscription_id = COALESCE(${subId || null}, verification_subscription_id),
                verification_status = CASE WHEN verification_status = 'verified' THEN verification_status ELSE 'pending' END,
                updated_at = now()
            WHERE id = ${userId}::uuid
          `;
          console.log(`[verify] Onetime fee paid for ${userId}, sub=${subId}`);

          // Send payment receipt email (non-blocking, idempotent at webhook layer)
          try {
            const [u] = await sql`SELECT email FROM users WHERE id = ${userId}::uuid`;
            if (u?.email) {
              const amountStr =
                typeof s.amount_total === "number"
                  ? `${(s.amount_total / 100).toFixed(2)} ${(s.currency || "usd").toUpperCase()}`
                  : null;
              await sendVerificationPaymentReceiptEmail(u.email, {
                amount: amountStr,
                subscriptionId: subId || null,
              });
            }
          } catch (e: any) {
            console.error("[verify] payment receipt email failed:", e?.message);
          }
        }
      }
    }

    // Identity session verified → grant verified status
    if (event.type === "identity.verification_session.verified") {
      const session = event.data.object as any;
      const userId = session.metadata?.user_id;
      if (userId) {
        // Capture prior verified_at so we only send the email on the FIRST
        // transition to verified (defense in depth — top-level idempotency
        // already prevents replay, but Stripe may re-send across sessions).
        const [prev] = await sql`
          SELECT email, verified_at FROM users WHERE id = ${userId}::uuid
        `;
        await sql`
          UPDATE users
          SET verification_status = 'verified',
              verified_at = COALESCE(verified_at, now()),
              verification_lapsed_at = NULL,
              updated_at = now()
          WHERE id = ${userId}::uuid
        `;
        console.log(`[verify] Identity verified for ${userId}`);

        if (prev?.email && !prev?.verified_at) {
          try {
            await sendVerificationApprovedEmail(prev.email);
          } catch (e: any) {
            console.error("[verify] approved email failed:", e?.message);
          }
        }
      }
    }

    // Identity failed / requires input — keep pending, log it
    if (
      event.type === "identity.verification_session.requires_input" ||
      event.type === "identity.verification_session.canceled"
    ) {
      const session = event.data.object as any;
      const userId = session.metadata?.user_id;
      if (userId) {
        console.log(`[verify] Identity ${event.type} for ${userId}`);
      }
    }

    // Verification subscription invoice paid → bump renews_at
    if (event.type === "invoice.paid") {
      const inv = event.data.object as any;
      const subId = getInvoiceSubscriptionId(inv);
      const lineMeta = inv.lines?.data?.[0]?.metadata || {};
      const isVerifySub = lineMeta.type === "creator_verification";
      if (subId && isVerifySub && lineMeta.user_id) {
        const periodEnd = inv.lines?.data?.[0]?.period?.end;
        const renewsAt = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
        await sql`
          UPDATE users
          SET verification_renews_at = ${renewsAt}::timestamptz,
              verification_subscription_id = ${subId},
              verification_lapsed_at = NULL,
              updated_at = now()
          WHERE id = ${lineMeta.user_id}::uuid
        `;
        console.log(`[verify] Sub renewed for ${lineMeta.user_id} until ${renewsAt}`);
      }
    }

    // Verification sub deleted or payment failed → IMMEDIATE revoke
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.type === "creator_verification" && sub.metadata?.user_id) {
        await sql`
          UPDATE users
          SET verification_status = 'lapsed',
              verification_lapsed_at = now(),
              verification_renews_at = NULL,
              updated_at = now()
          WHERE id = ${sub.metadata.user_id}::uuid
        `;
        console.log(`[verify] Subscription deleted, revoked for ${sub.metadata.user_id}`);
      }
    }

    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object as any;
      const lineMeta = inv.lines?.data?.[0]?.metadata || {};
      if (lineMeta.type === "creator_verification" && lineMeta.user_id) {
        await sql`
          UPDATE users
          SET verification_status = 'lapsed',
              verification_lapsed_at = now(),
              updated_at = now()
          WHERE id = ${lineMeta.user_id}::uuid
        `;
        console.log(`[verify] Payment failed, revoked for ${lineMeta.user_id}`);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[webhook]", err.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

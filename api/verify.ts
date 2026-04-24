/**
 * /api/verify — Creator identity verification (Stripe Identity + monthly sub).
 *
 * Flow:
 *   1. POST { action: "start" } → creates Stripe Checkout for the one-time fee
 *      AND the monthly verification subscription. After payment success, the
 *      webhook sets verification_onetime_paid=true and creates the Identity
 *      session. Frontend then calls action="identity" to get the ID flow URL.
 *   2. POST { action: "identity" } → creates a Stripe Identity VerificationSession
 *      (only if onetime fee is paid) and returns the hosted URL + client secret.
 *   3. GET → returns current verification status.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const SITE_URL = process.env.SITE_URL || "http://localhost:5173";
    const PRICE_ONETIME = process.env.STRIPE_PRICE_VERIFY_ONETIME;
    const PRICE_MONTHLY = process.env.STRIPE_PRICE_VERIFY_MONTHLY;
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });

    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    await checkRateLimit(auth.userId, "verify", { max: 30, windowSeconds: 60 });

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const sql = getDb();

    // GET — current status (with Stripe reconciliation fallback in case the
    // webhook was delayed/missed and the user already completed Checkout)
    if (req.method === "GET") {
      let [row] = await sql`
        SELECT verification_status, verification_session_id,
               verification_subscription_id, verification_checkout_id,
               verification_onetime_paid, verified_at,
               verification_renews_at, verification_lapsed_at
        FROM users WHERE id = ${auth.userId}::uuid
      `;

      if (row && (!row.verification_onetime_paid || !row.verification_subscription_id || !row.verification_renews_at)) {
        const existingRenewsAt = row.verification_renews_at
          ? new Date(row.verification_renews_at).toISOString()
          : null;
        let reconciledSubscriptionId: string | null = row.verification_subscription_id || null;
        let reconciledOnetimePaid = !!row.verification_onetime_paid;
        let reconciledRenewsAt: string | null = existingRenewsAt;

        if (row.verification_checkout_id) {
          try {
            const session = await stripe.checkout.sessions.retrieve(row.verification_checkout_id);
            const sessionSubscriptionId =
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id || null;
            if (session.payment_status && session.payment_status !== "unpaid") {
              reconciledOnetimePaid = true;
            }
            if (sessionSubscriptionId) {
              reconciledSubscriptionId = sessionSubscriptionId;
            }
          } catch (err: any) {
            console.error("[verify] checkout reconciliation failed:", err?.message);
          }
        }

        if (reconciledSubscriptionId && !reconciledRenewsAt) {
          try {
            const sub = await stripe.subscriptions.retrieve(reconciledSubscriptionId);
            const currentPeriodEnd = (sub as any)?.current_period_end as number | undefined;
            if (["active", "trialing", "past_due"].includes(sub.status)) {
              reconciledSubscriptionId = sub.id;
              reconciledRenewsAt = currentPeriodEnd
                ? new Date(currentPeriodEnd * 1000).toISOString()
                : null;
            }
          } catch (err: any) {
            console.error("[verify] subscription reconciliation failed:", err?.message);
          }
        }

        if (
          reconciledOnetimePaid !== !!row.verification_onetime_paid ||
          reconciledSubscriptionId !== (row.verification_subscription_id || null) ||
          reconciledRenewsAt !== existingRenewsAt
        ) {
          await sql`
            UPDATE users
            SET verification_onetime_paid = ${reconciledOnetimePaid},
                verification_subscription_id = ${reconciledSubscriptionId},
                verification_renews_at = ${reconciledRenewsAt}::timestamptz,
                verification_status = CASE
                  WHEN verification_status = 'verified' THEN verification_status
                  WHEN ${reconciledOnetimePaid} THEN 'pending'
                  ELSE verification_status
                END,
                updated_at = now()
            WHERE id = ${auth.userId}::uuid
          `;

          [row] = await sql`
            SELECT verification_status, verification_session_id,
                   verification_subscription_id, verification_checkout_id,
                   verification_onetime_paid, verified_at,
                   verification_renews_at, verification_lapsed_at
            FROM users WHERE id = ${auth.userId}::uuid
          `;
        }
      }

      const isActive =
        row?.verification_status === "verified" &&
        (!row?.verification_renews_at || new Date(row.verification_renews_at) > new Date());
      return res.json({
        status: row?.verification_status || "unverified",
        isVerified: isActive,
        onetimePaid: !!row?.verification_onetime_paid,
        sessionId: row?.verification_session_id || null,
        subscriptionId: row?.verification_subscription_id || null,
        verifiedAt: row?.verified_at || null,
        renewsAt: row?.verification_renews_at || null,
        lapsedAt: row?.verification_lapsed_at || null,
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { action } = req.body || {};

    // Require email verified before paying for ID verification
    const [userRow] = await sql`SELECT email_verified, stripe_customer_id, verification_status, verification_onetime_paid FROM users WHERE id = ${auth.userId}::uuid`;
    if (!userRow?.email_verified) {
      return res.status(403).json({ error: "Verify your email first" });
    }

    // ── action: "start" ── one-time fee + monthly sub via Checkout
    if (action === "start") {
      if (!PRICE_ONETIME || !PRICE_MONTHLY) {
        return res.status(500).json({ error: "Verification prices not configured" });
      }

      // Reuse or create Stripe customer
      let customerId: string = userRow.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: auth.email,
          metadata: { user_id: auth.userId },
        });
        customerId = customer.id;
        await sql`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${auth.userId}::uuid`;
      }

      // Validate price types up-front so we surface clear errors instead of
      // a confusing "received unknown parameter" from Stripe.
      const [onetimePrice, monthlyPrice] = await Promise.all([
        stripe.prices.retrieve(PRICE_ONETIME),
        stripe.prices.retrieve(PRICE_MONTHLY),
      ]);
      if (monthlyPrice.recurring == null) {
        return res.status(500).json({
          error: `STRIPE_PRICE_VERIFY_MONTHLY (${PRICE_MONTHLY}) must be a recurring price.`,
        });
      }
      if (onetimePrice.recurring != null) {
        return res.status(500).json({
          error: `STRIPE_PRICE_VERIFY_ONETIME (${PRICE_ONETIME}) must be a one-time price (no recurring interval). add_invoice_items only accepts one-time prices.`,
        });
      }

      // Subscription mode supports mixing recurring + one-time prices in line_items.
      // The one-time fee gets added to the first subscription invoice automatically.
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [
          { price: PRICE_MONTHLY, quantity: 1 },
          { price: PRICE_ONETIME, quantity: 1 },
        ],
        subscription_data: {
          metadata: {
            user_id: auth.userId,
            type: "creator_verification",
          },
        },
        client_reference_id: auth.userId,
        metadata: {
          user_id: auth.userId,
          type: "creator_verification_start",
        },
        success_url: `${SITE_URL}/verification?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/verification?cancelled=1`,
      });

      // Mark pending so UI can show "in progress"
      await sql`
        UPDATE users
        SET verification_status = CASE WHEN verification_status = 'verified' THEN verification_status ELSE 'pending' END,
            verification_checkout_id = ${session.id},
            updated_at = now()
        WHERE id = ${auth.userId}::uuid
      `;
      return res.json({ url: session.url });
    }

    // ── action: "identity" ── only allowed once one-time fee has been paid
    if (action === "identity") {
      if (!userRow.verification_onetime_paid) {
        return res.status(402).json({ error: "Pay the verification fee first" });
      }
      if (userRow.verification_status === "verified") {
        return res.json({ status: "verified", alreadyVerified: true });
      }

      const idSession = await stripe.identity.verificationSessions.create({
        type: "document",
        options: { document: { require_matching_selfie: true, require_live_capture: true } },
        metadata: { user_id: auth.userId },
        return_url: `${SITE_URL}/?verify=identity_done`,
      });

      await sql`
        UPDATE users
        SET verification_session_id = ${idSession.id},
            verification_status = 'pending',
            updated_at = now()
        WHERE id = ${auth.userId}::uuid
      `;

      return res.json({
        sessionId: idSession.id,
        clientSecret: idSession.client_secret,
        url: idSession.url,
      });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("[verify]", err.message, err.stack);
    return res.status(500).json({ error: err.message || "Verification request failed" });
  }
}

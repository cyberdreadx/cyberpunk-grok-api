/**
 * Stripe Connect (Express) onboarding for creator payouts.
 *
 * GET                       → { enabled, accountId, payoutsEnabled, detailsSubmitted, chargesEnabled }
 * POST { action:"onboard" } → create/reuse Express account, return { url } (Stripe-hosted onboarding)
 * POST { action:"dashboard"}→ Express login link for an onboarded creator, return { url }
 *
 * Requires the restricted key to have Connect scopes:
 *   rak_account_write, rak_account_link_write  (and rak_transfer_write for actual payouts).
 * Errors from Stripe naming a missing `rak_*` permission are surfaced verbatim.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";
import { isVerified, VERIFICATION_REQUIRED_MESSAGE } from "./_lib/verifiedGate";

const APP_URL = "https://grokrunner.gltch.app";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });

  const { allowed } = await checkRateLimit(auth.userId, "connect", { max: 20, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Too many requests" });

  const sql = getDb();
  const stripe = new Stripe(STRIPE_SECRET_KEY);

  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT`.catch(() => {});

    const [user] = await sql`
      SELECT email, stripe_connect_account_id FROM users WHERE id = ${auth.userId}::uuid
    `;
    let accountId: string | null = user?.stripe_connect_account_id || null;

    // ── GET: status ──
    if (req.method === "GET") {
      if (!accountId) {
        return res.json({ enabled: false, accountId: null, payoutsEnabled: false, detailsSubmitted: false, chargesEnabled: false });
      }
      try {
        const acct = await stripe.accounts.retrieve(accountId);
        return res.json({
          enabled: true,
          accountId,
          payoutsEnabled: !!acct.payouts_enabled,
          detailsSubmitted: !!acct.details_submitted,
          chargesEnabled: !!acct.charges_enabled,
        });
      } catch (e: any) {
        console.error("[connect] retrieve:", e?.message);
        return res.json({ enabled: false, accountId, payoutsEnabled: false, detailsSubmitted: false, chargesEnabled: false, error: e?.message });
      }
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const action = (req.body?.action as string) || "onboard";

    // ── POST onboard ── (verified creators only)
    if (action === "onboard") {
      if (!(await isVerified(sql, auth.userId))) {
        return res.status(403).json({ error: VERIFICATION_REQUIRED_MESSAGE, code: "VERIFICATION_REQUIRED" });
      }

      if (!accountId) {
        const acct = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: user?.email || undefined,
          capabilities: { transfers: { requested: true } },
          business_type: "individual",
          metadata: { userId: auth.userId },
        });
        accountId = acct.id;
        await sql`UPDATE users SET stripe_connect_account_id = ${accountId}, updated_at = now() WHERE id = ${auth.userId}::uuid`;
      }

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${APP_URL}/profile?connect=refresh`,
        return_url: `${APP_URL}/profile?connect=done`,
        type: "account_onboarding",
      });
      return res.json({ url: link.url });
    }

    // ── POST dashboard ── (Express login link)
    if (action === "dashboard") {
      if (!accountId) return res.status(400).json({ error: "No Stripe account yet — set up payouts first." });
      const link = await stripe.accounts.createLoginLink(accountId);
      return res.json({ url: link.url });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("[connect]", err?.message);
    // Surface Stripe permission errors verbatim so the missing rak_* scope is obvious.
    return res.status(502).json({ error: err?.message || "Stripe Connect request failed" });
  }
}

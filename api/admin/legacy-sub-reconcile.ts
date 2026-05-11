/**
 * /api/admin/legacy-sub-reconcile — admin tool to find old Stripe subscription
 * charges on legacy price IDs and grant the missing credits.
 *
 * GET  ?since=YYYY-MM-DD&limit=100
 *   Scans paid Stripe invoices, returns ones on price IDs NOT in the current
 *   STRIPE_PRICE_SUB_* env map. For each, computes owed credits, looks up the
 *   user, and reports how many credits are still missing (already-credited
 *   amount comes from `transactions.stripe_session_id = invoice.id`).
 *
 * POST { invoiceIds: string[] }
 *   Grants the missing credits for the listed invoices. Idempotent: re-running
 *   only ever tops up to the owed amount (uses transactions row as ledger).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getDb } from "../_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "../_lib/auth";
import { applyCors } from "../_lib/cors";

const CREDITS_PER_DOLLAR = Number(process.env.LEGACY_CREDITS_PER_DOLLAR || 13);

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

function currentPriceIds(): Set<string> {
  return new Set(
    [
      "STRIPE_PRICE_SUB_BASIC", "STRIPE_PRICE_SUB_PREMIUM", "STRIPE_PRICE_SUB_PRO", "STRIPE_PRICE_SUB_ELITE",
      "STRIPE_PRICE_SUB_BASIC_YEARLY", "STRIPE_PRICE_SUB_PREMIUM_YEARLY", "STRIPE_PRICE_SUB_PRO_YEARLY", "STRIPE_PRICE_SUB_ELITE_YEARLY",
    ].map(k => process.env[k] || "").filter(Boolean)
  );
}

function legacyOverrides(): Record<string, number> {
  try {
    const raw = process.env.STRIPE_LEGACY_PRICE_CREDITS;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function computeOwed(priceIds: string[], amountPaidCents: number, overrides: Record<string, number>): number {
  for (const pid of priceIds) {
    if (overrides[pid] != null) return overrides[pid];
  }
  if (amountPaidCents <= 0) return 0;
  return Math.max(1, Math.floor((amountPaidCents / 100) * CREDITS_PER_DOLLAR));
}

interface ReconcileRow {
  invoiceId: string;
  customerId: string | null;
  customerEmail: string | null;
  amountPaidCents: number;
  priceIds: string[];
  owed: number;
  alreadyCredited: number;
  missing: number;
  userId: string | null;
  userEmail: string | null;
  createdAt: number;
  status: "ready" | "no_user" | "fully_credited";
  reason?: string;
}

async function resolveUser(sql: any, stripe: Stripe, invoice: Stripe.Invoice): Promise<{ userId: string | null; userEmail: string | null }> {
  const customerId = invoice.customer as string | null;
  if (customerId) {
    const rows = await sql`SELECT id, email FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1`;
    if (rows[0]?.id) return { userId: rows[0].id, userEmail: rows[0].email };
  }
  let email = (invoice as any).customer_email as string | undefined;
  if (!email && customerId) {
    try {
      const c = await stripe.customers.retrieve(customerId);
      if (!(c as any).deleted) email = (c as Stripe.Customer).email || undefined;
    } catch {}
  }
  if (email) {
    const rows = await sql`SELECT id, email FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
    if (rows[0]?.id) return { userId: rows[0].id, userEmail: rows[0].email };
    return { userId: null, userEmail: email };
  }
  return { userId: null, userEmail: null };
}

async function buildReport(sql: any, stripe: Stripe, since: number | undefined, limit: number): Promise<ReconcileRow[]> {
  const current = currentPriceIds();
  const overrides = legacyOverrides();
  const out: ReconcileRow[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  outer: while (true) {
    const params: Stripe.InvoiceListParams = {
      status: "paid",
      limit: 100,
      starting_after: cursor,
      ...(since ? { created: { gte: since } } : {}),
    };
    const batch = await stripe.invoices.list(params);
    for (const inv of batch.data) {
      scanned++;
      const subId = (inv as any).subscription as string | null;
      if (!subId) continue;

      const line = (inv as any).lines?.data?.[0];
      const priceIds: string[] = [];
      const linePid = line?.price?.id || line?.pricing?.price_details?.price;
      if (linePid) priceIds.push(linePid);
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        const subPid = (sub.items?.data?.[0] as any)?.price?.id;
        if (subPid && !priceIds.includes(subPid)) priceIds.push(subPid);
      } catch {}
      if (priceIds.length === 0) continue;
      // Skip current-price subs (they use discount-only model, no credits owed).
      if (priceIds.some(p => current.has(p))) continue;

      const owed = computeOwed(priceIds, inv.amount_paid || 0, overrides);
      if (owed <= 0) continue;

      const { userId, userEmail } = await resolveUser(sql, stripe, inv);
      let alreadyCredited = 0;
      if (userId || inv.id) {
        const ex = await sql`SELECT credits FROM transactions WHERE stripe_session_id = ${inv.id} LIMIT 1`;
        alreadyCredited = ex[0]?.credits || 0;
      }
      const missing = Math.max(0, owed - alreadyCredited);

      out.push({
        invoiceId: inv.id!,
        customerId: (inv.customer as string) || null,
        customerEmail: (inv as any).customer_email || null,
        amountPaidCents: inv.amount_paid || 0,
        priceIds,
        owed,
        alreadyCredited,
        missing,
        userId,
        userEmail,
        createdAt: inv.created,
        status: !userId ? "no_user" : missing <= 0 ? "fully_credited" : "ready",
      });

      if (out.length >= limit) break outer;
    }
    if (!batch.has_more) break;
    cursor = batch.data[batch.data.length - 1].id;
    if (scanned > 5000) break; // hard safety cap per request
  }
  return out;
}

async function applyGrants(sql: any, stripe: Stripe, invoiceIds: string[]): Promise<{
  granted: { invoiceId: string; userId: string; credits: number }[];
  skipped: { invoiceId: string; reason: string }[];
}> {
  const overrides = legacyOverrides();
  const current = currentPriceIds();
  const granted: { invoiceId: string; userId: string; credits: number }[] = [];
  const skipped: { invoiceId: string; reason: string }[] = [];

  for (const id of invoiceIds) {
    try {
      const inv = await stripe.invoices.retrieve(id);
      if (inv.status !== "paid") { skipped.push({ invoiceId: id, reason: `not paid (${inv.status})` }); continue; }
      const line = (inv as any).lines?.data?.[0];
      const priceIds: string[] = [];
      const linePid = line?.price?.id || line?.pricing?.price_details?.price;
      if (linePid) priceIds.push(linePid);
      const subId = (inv as any).subscription as string | null;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          const subPid = (sub.items?.data?.[0] as any)?.price?.id;
          if (subPid && !priceIds.includes(subPid)) priceIds.push(subPid);
        } catch {}
      }
      if (priceIds.some(p => current.has(p))) { skipped.push({ invoiceId: id, reason: "current price (no credits owed)" }); continue; }

      const owed = computeOwed(priceIds, inv.amount_paid || 0, overrides);
      if (owed <= 0) { skipped.push({ invoiceId: id, reason: "owed=0" }); continue; }

      const { userId } = await resolveUser(sql, stripe, inv);
      if (!userId) { skipped.push({ invoiceId: id, reason: "no matching user" }); continue; }

      const ex = await sql`SELECT credits FROM transactions WHERE stripe_session_id = ${inv.id} LIMIT 1`;
      const already = ex[0]?.credits || 0;
      const delta = owed - already;
      if (delta <= 0) { skipped.push({ invoiceId: id, reason: "already fully credited" }); continue; }

      await sql`SELECT add_pack_credits(${userId}::uuid, ${delta})`;
      if (ex[0]) {
        await sql`UPDATE transactions SET credits = ${owed}, package = 'legacy_backfill' WHERE stripe_session_id = ${inv.id}`;
      } else {
        await sql`
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
          VALUES (${userId}::uuid, ${owed}, ${inv.amount_paid || 0}, ${inv.id}, 'legacy_backfill', 'subscription', 'unknown')
          ON CONFLICT (stripe_session_id) DO NOTHING
        `;
      }
      // Persist customer id back if missing.
      if (inv.customer) {
        await sql`UPDATE users SET stripe_customer_id = ${inv.customer as string} WHERE id = ${userId}::uuid AND stripe_customer_id IS NULL`;
      }
      granted.push({ invoiceId: id, userId, credits: delta });
    } catch (e: any) {
      skipped.push({ invoiceId: id, reason: `error: ${e.message}` });
    }
  }
  return { granted, skipped };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!isAdmin(req)) return res.status(403).json({ error: "Access denied" });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const sql = getDb();

  try {
    if (req.method === "GET") {
      const sinceStr = (req.query.since as string) || "";
      const limit = Math.min(500, parseInt((req.query.limit as string) || "200", 10));
      const since = sinceStr ? Math.floor(new Date(sinceStr).getTime() / 1000) : undefined;
      const rows = await buildReport(sql, stripe, since, limit);
      const summary = {
        total: rows.length,
        ready: rows.filter(r => r.status === "ready").length,
        noUser: rows.filter(r => r.status === "no_user").length,
        fullyCredited: rows.filter(r => r.status === "fully_credited").length,
        missingCreditsTotal: rows.reduce((s, r) => s + (r.status === "ready" ? r.missing : 0), 0),
        currentPriceIds: [...currentPriceIds()],
        creditsPerDollar: CREDITS_PER_DOLLAR,
      };
      return res.status(200).json({ summary, rows });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const ids: string[] = Array.isArray(body.invoiceIds) ? body.invoiceIds.filter((x: any) => typeof x === "string") : [];
      if (ids.length === 0) return res.status(400).json({ error: "invoiceIds[] required" });
      if (ids.length > 200) return res.status(400).json({ error: "max 200 invoices per request" });
      const result = await applyGrants(sql, stripe, ids);
      console.log(`[admin/legacy-sub-reconcile] granted ${result.granted.length}, skipped ${result.skipped.length}`);
      return res.status(200).json({ ok: true, ...result });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    console.error("[admin/legacy-sub-reconcile]", e.message);
    return res.status(500).json({ error: e.message });
  }
}

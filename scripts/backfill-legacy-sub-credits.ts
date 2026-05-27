/**
 * scripts/backfill-legacy-sub-credits.ts
 *
 * Reconcile already-charged legacy subscription invoices and grant any missing
 * credits. Mirrors the runtime logic added to api/webhook.ts (legacy-price
 * detection + ~13 credits/$ fallback) but applies it retroactively.
 *
 * What it does, per Stripe `invoice.paid`:
 *   1. Skip non-subscription invoices and zero-amount invoices.
 *   2. Resolve the price ID(s) on the invoice line + subscription item.
 *   3. If ANY price ID is in the current STRIPE_PRICE_SUB_* env map, this is a
 *      "current" sub — skip (those use the discount-only model).
 *   4. Otherwise it's a LEGACY sub. Compute owed credits:
 *        - STRIPE_LEGACY_PRICE_CREDITS JSON override per price ID, OR
 *        - floor((amount_paid_cents / 100) * 13)
 *   5. Resolve the user via stripe_customer_id, then email lookup as fallback.
 *   6. Check `transactions` for a row with this `stripe_session_id` (= invoice id).
 *      If it exists with credits >= owed → skip. Otherwise grant the delta and
 *      upsert a transaction row marked `legacy_backfill`.
 *
 * USAGE
 *   DRY_RUN=1 \
 *   STRIPE_SECRET_KEY=sk_live_... \
 *   DATABASE_URL=postgres://... \
 *   STRIPE_PRICE_SUB_BASIC=price_... STRIPE_PRICE_SUB_PRO=price_... ... \
 *   [STRIPE_LEGACY_PRICE_CREDITS='{"price_xxx":300}'] \
 *   [SINCE=2024-01-01] \
 *   bunx tsx scripts/backfill-legacy-sub-credits.ts
 *
 * Set DRY_RUN=0 (or unset and pass --apply) to actually write changes.
 *
 * Safe to re-run: idempotent via `transactions.stripe_session_id` UNIQUE.
 */

import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import {
  getCurrentSubPriceIds,
  extractSubPriceIds,
  getInvoiceSubscriptionId,
  isLegacySubPrice,
  computeLegacyCreditGrant,
  parseCreditsPerMonthFromMeta,
} from "../api/_lib/stripe-sub-prices.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN !== "0" && !process.argv.includes("--apply");
const RECORD_ONLY = process.argv.includes("--record-only") || process.env.RECORD_ONLY === "1";
const SINCE = process.env.SINCE ? Math.floor(new Date(process.env.SINCE).getTime() / 1000) : undefined;
const CREDITS_PER_DOLLAR = Number(process.env.LEGACY_CREDITS_PER_DOLLAR || 13);

if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY required");
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const stripe = new Stripe(STRIPE_SECRET_KEY);
const sql = neon(DATABASE_URL);

// Build current-price set from env (matches webhook getCurrentSubPriceIds).
const CURRENT_PRICE_IDS = getCurrentSubPriceIds();

interface Stat {
  scanned: number;
  skippedNonSub: number;
  skippedCurrent: number;
  skippedAlreadyCredited: number;
  skippedNoUser: number;
  granted: number;
  creditsTotal: number;
  errors: number;
}
const stats: Stat = { scanned: 0, skippedNonSub: 0, skippedCurrent: 0, skippedAlreadyCredited: 0, skippedNoUser: 0, granted: 0, creditsTotal: 0, errors: 0 };

async function resolveUserId(invoice: Stripe.Invoice): Promise<{ id: string | null; email?: string }> {
  const customerId = invoice.customer as string | null;
  if (customerId) {
    const rows = await sql`SELECT id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1` as any[];
    if (rows[0]?.id) return { id: rows[0].id };
  }
  // Email fallback
  let email = (invoice as any).customer_email as string | undefined;
  if (!email && customerId) {
    try {
      const c = await stripe.customers.retrieve(customerId);
      if (!(c as any).deleted) email = (c as Stripe.Customer).email || undefined;
    } catch {}
  }
  if (email) {
    const rows = await sql`SELECT id FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1` as any[];
    if (rows[0]?.id) {
      // Persist customer ID for future webhook calls.
      if (customerId && !DRY_RUN) {
        await sql`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${rows[0].id}::uuid AND stripe_customer_id IS NULL`;
      }
      return { id: rows[0].id, email };
    }
    return { id: null, email };
  }
  return { id: null };
}

async function processInvoice(invoice: Stripe.Invoice) {
  stats.scanned++;
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId || invoice.status !== "paid") {
    stats.skippedNonSub++;
    return;
  }

  const line = (invoice as any).lines?.data?.[0];
  const priceIds: string[] = [];
  let subscription: Stripe.Subscription | null = null;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    priceIds.push(...extractSubPriceIds(invoice, subscription));
  } catch {
    priceIds.push(...extractSubPriceIds(invoice, null));
  }

  if (priceIds.length === 0) { stats.skippedNonSub++; return; }
  if (!isLegacySubPrice(priceIds)) {
    stats.skippedCurrent++;
    return;
  }

  const creditsPerMonthMeta = subscription ? parseCreditsPerMonthFromMeta(subscription.metadata) : 0;
  const owed = computeLegacyCreditGrant({
    priceIds,
    amountPaidCents: invoice.amount_paid || 0,
    creditsPerMonthMeta: creditsPerMonthMeta || undefined,
  });
  if (owed <= 0) { stats.skippedNonSub++; return; }

  const { id: userId, email } = await resolveUserId(invoice);
  if (!userId) {
    stats.skippedNoUser++;
    console.warn(`[backfill] NO USER for invoice ${invoice.id} customer=${invoice.customer} email=${email || "?"} owed=${owed}`);
    return;
  }

  // Check existing transaction for this invoice.
  const existing = await sql`
    SELECT credits FROM transactions WHERE stripe_session_id = ${invoice.id} LIMIT 1
  ` as any[];
  const alreadyCredited = existing[0]?.credits || 0;
  const delta = owed - alreadyCredited;
  if (delta <= 0) {
    stats.skippedAlreadyCredited++;
    return;
  }

  const action = DRY_RUN ? "[DRY]" : "[APPLY]";
  console.log(`${action} grant ${delta} credits to user=${userId} (already=${alreadyCredited}, owed=${owed}) invoice=${invoice.id} price=${priceIds.join(",")} paid=$${(invoice.amount_paid / 100).toFixed(2)}`);

  if (!DRY_RUN) {
    try {
      if (existing[0]) {
        await sql`UPDATE transactions SET credits = ${owed}, package = 'legacy_backfill' WHERE stripe_session_id = ${invoice.id}`;
        if (!RECORD_ONLY) {
          const delta2 = owed - alreadyCredited;
          if (delta2 > 0) await sql`SELECT add_pack_credits(${userId}::uuid, ${delta2})`;
        }
      } else {
        const inserted = await sql`
          INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
          SELECT ${userId}::uuid, ${owed}, ${invoice.amount_paid || 0}, ${invoice.id}, 'legacy_backfill', 'subscription', 'unknown'
          WHERE NOT EXISTS (
            SELECT 1 FROM transactions t WHERE t.stripe_session_id = ${invoice.id}
          )
          RETURNING id
        `;
        if (inserted.length === 0) {
          stats.skippedAlreadyCredited++;
          return;
        }
        if (!RECORD_ONLY) {
          await sql`SELECT add_pack_credits(${userId}::uuid, ${delta})`;
        }
      }
      stats.granted++;
      stats.creditsTotal += RECORD_ONLY ? 0 : delta;
    } catch (e: any) {
      stats.errors++;
      console.error(`[backfill] grant FAILED for invoice ${invoice.id}:`, e.message);
    }
  } else {
    stats.granted++;
    stats.creditsTotal += delta;
  }
}

async function main() {
  console.log("=== Legacy Subscription Credit Backfill ===");
  console.log("Mode:", RECORD_ONLY ? "RECORD ONLY (ledger rows, no credits)" : DRY_RUN ? "DRY RUN (no writes)" : "APPLY (writing changes)");
  console.log("Current price IDs (skip these):", [...CURRENT_PRICE_IDS]);
  console.log("Credits/$:", CREDITS_PER_DOLLAR);
  console.log("Since:", SINCE ? new Date(SINCE * 1000).toISOString() : "(all)");
  console.log("");

  let cursor: string | undefined;
  let page = 0;
  do {
    page++;
    const params: Stripe.InvoiceListParams = {
      status: "paid",
      limit: 100,
      starting_after: cursor,
      ...(SINCE ? { created: { gte: SINCE } } : {}),
    };
    const batch = await stripe.invoices.list(params);
    console.log(`-- page ${page}: ${batch.data.length} invoices`);
    for (const inv of batch.data) {
      try {
        await processInvoice(inv);
      } catch (e: any) {
        stats.errors++;
        console.error(`[backfill] error on invoice ${inv.id}:`, e.message);
      }
    }
    cursor = batch.has_more ? batch.data[batch.data.length - 1].id : undefined;
  } while (cursor);

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(stats, null, 2));
  if (DRY_RUN) console.log("\nRe-run with --apply (or DRY_RUN=0) to actually write changes.");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });

/**
 * Stripe ground truth for the admin finance panel.
 *
 * The `transactions` table only ever learns about money coming IN, and only
 * when a webhook lands. It never hears about refunds, disputes, or Stripe's
 * cut, so "revenue" in the admin panel has always been gross bookings rather
 * than money that reached the bank. This module reads the balance-transaction
 * ledger, which is the same thing Stripe's own dashboard reports from, and is
 * the only source that carries `fee` and `net` per item.
 *
 * The live key is a restricted key: balance, balance_transactions, charges,
 * refunds, subscriptions, prices, invoices and payouts read fine; `disputes`
 * and `reporting` return a permission error, so chargebacks are visible only
 * as `adjustment` ledger entries (amount + fee, no reason code).
 *
 * Everything is cached in-process — a 6-month pull is ~40 sequential API round
 * trips and the panel is polled by refresh clicks.
 */

import Stripe from "stripe";
import { getDb } from "./db";

export interface StripeWindow {
  /** Days covered, or null for all-time. */
  days: number | null;
  /** Customer money in, before fees. */
  grossCents: number;
  /** Stripe's cut on those charges (always reported positive). */
  feeCents: number;
  /** Refunds issued, positive. */
  refundCents: number;
  /** Chargebacks + other ledger adjustments, positive when money left. */
  adjustmentCents: number;
  /** Account-level fees not attached to a charge (billing, radar, payouts). */
  otherFeeCents: number;
  /** Charges on this account that aren't platform revenue (see NON_PLATFORM_TYPES). */
  nonPlatformCents: number;
  nonPlatformCount: number;
  /** grossCents minus nonPlatformCents — what the product actually earned. */
  platformGrossCents: number;
  /** What actually landed: gross − fees − refunds − adjustments. */
  netCents: number;
  chargeCount: number;
  refundCount: number;
  adjustmentCount: number;
  /** Effective take rate on gross, e.g. 0.031. */
  effectiveFeeRate: number;
  /** Per-bucket series for charting. */
  series: { day: string; gross: number; fee: number; refund: number; net: number }[];
  /** True if we stopped early at the page cap and numbers are partial. */
  truncated: boolean;
}

export interface StripeMrr {
  activeCount: number;
  /** Normalized monthly recurring revenue in cents. */
  mrrCents: number;
  /** MRR × 12. */
  arrCents: number;
  cancellingCount: number;
  /** MRR that is already flagged to cancel at period end. */
  atRiskCents: number;
  byInterval: { interval: string; count: number; mrrCents: number }[];
  byPrice: { priceId: string; nickname: string; count: number; unitAmount: number; mrrCents: number }[];
  truncated: boolean;
}

export interface StripeBalance {
  availableCents: number;
  pendingCents: number;
}

const PAGE_LIMIT = 100;
/** Hard cap so a bad range can't spin for minutes against Stripe. */
const MAX_PAGES = 120;
const CACHE_TTL_MS = 10 * 60_000;

const cache = new Map<string, { at: number; value: any }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value as T);
  return fn().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

/** Drop every cached window — called after a manual "force refresh". */
export function clearStripeCache(): void {
  cache.clear();
}

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

function bucketKey(unixSeconds: number, bucket: string): string {
  const d = new Date(unixSeconds * 1000);
  if (bucket === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  if (bucket === "week") {
    // ISO-ish: snap back to Monday so buckets line up with date_trunc('week').
    const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = (copy.getUTCDay() + 6) % 7;
    copy.setUTCDate(copy.getUTCDate() - dow);
    return copy.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Checkout-session metadata types that are NOT platform revenue. The Stripe
 * account is shared with an event the owner used to run, whose sessions carry
 * `type: "ticket"`; no webhook branch handles them, so they can never appear in
 * `transactions` and would otherwise show up forever as reconciliation drift.
 */
function nonPlatformTypes(): Set<string> {
  const raw = process.env.STRIPE_NON_PLATFORM_TYPES ?? "ticket";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

interface DayRow {
  day: string;
  gross_cents: number; fee_cents: number; refund_cents: number;
  adjustment_cents: number; other_fee_cents: number;
  charge_count: number; refund_count: number; adjustment_count: number;
  non_platform_cents: number; non_platform_count: number;
}

function emptyDay(day: string): DayRow {
  return {
    day, gross_cents: 0, fee_cents: 0, refund_cents: 0, adjustment_cents: 0,
    other_fee_cents: 0, charge_count: 0, refund_count: 0, adjustment_count: 0,
    non_platform_cents: 0, non_platform_count: 0,
  };
}

/**
 * Fold one balance-transaction into a day bucket.
 *
 * Sign convention: Stripe reports `amount` signed from the account's point of
 * view (charges positive, refunds and payouts negative) and `fee` positive on
 * a charge. We flip refunds and adjustments back to positive magnitudes,
 * because "gross − refunds − fees" reads better than a sum of mixed signs.
 * payout / advance / transfer are money movement, not revenue, and are skipped.
 */
function foldTxn(row: DayRow, t: Stripe.BalanceTransaction): void {
  switch (t.type) {
    case "charge":
    case "payment":
      row.gross_cents += t.amount;
      row.fee_cents += t.fee;
      row.charge_count++;
      break;
    case "refund":
    case "payment_refund":
    case "refund_failure":
      row.refund_cents += -t.amount;
      row.fee_cents += t.fee; // negative: Stripe returns the fee on a refund
      row.refund_count++;
      break;
    case "adjustment":
      row.adjustment_cents += -t.amount;
      row.adjustment_count++;
      break;
    case "stripe_fee":
    case "application_fee":
      row.other_fee_cents += -t.amount;
      break;
    default:
      break;
  }
}

/**
 * Pull daily ledger rollups, reading everything before today from Postgres and
 * asking Stripe only for what isn't cached yet.
 *
 * Safe because a past day is immutable: a refund issued today lands on today's
 * ledger, not on the day of the original charge. Today's row is always
 * re-fetched and re-upserted.
 */
async function syncDailyCache(stripe: Stripe, from: Date): Promise<void> {
  const sql = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const fromDay = from.toISOString().slice(0, 10);

  // The cache is only usable for this window if it already reaches back to (or
  // past) the window start — otherwise a wider range would silently report on
  // whatever narrower range was cached first.
  let bounds: { min_day: string | null; max_complete: string | null } | null = null;
  try {
    const rows = (await sql`
      SELECT MIN(day)::text AS min_day,
             MAX(day) FILTER (WHERE day < ${today}::date)::text AS max_complete
      FROM stripe_daily_cache
    `) as any[];
    bounds = rows[0] ?? null;
  } catch {
    // Table arrives with migration 055; before that, always fetch live.
    bounds = null;
  }

  let fetchFrom = fromDay;
  if (bounds?.min_day && bounds.max_complete && bounds.min_day <= fromDay) {
    const next = new Date(`${bounds.max_complete}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    // A day with no ledger activity writes no row, so "no row" and "quiet day"
    // are the same thing — walking forward from the last complete day is safe.
    fetchFrom = next.toISOString().slice(0, 10);
  }

  if (fetchFrom > today) return; // complete through yesterday, nothing new

  const gte = Math.floor(new Date(`${fetchFrom}T00:00:00Z`).getTime() / 1000);
  const days = new Map<string, DayRow>();
  let startingAfter: string | undefined;
  let pages = 0;

  for (;;) {
    const page: Stripe.ApiList<Stripe.BalanceTransaction> = await stripe.balanceTransactions.list({
      limit: PAGE_LIMIT,
      created: { gte },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const t of page.data) {
      const k = new Date(t.created * 1000).toISOString().slice(0, 10);
      let row = days.get(k);
      if (!row) { row = emptyDay(k); days.set(k, row); }
      foldTxn(row, t);
    }
    pages++;
    if (!page.has_more || pages >= MAX_PAGES) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  // Second pass: tag the non-platform share of each day from checkout-session
  // metadata, which the balance-transaction ledger doesn't carry. Sessions are
  // paid within minutes of creation, so bucketing on session date is accurate
  // enough to net out of the same day's gross.
  const skip = nonPlatformTypes();
  if (skip.size > 0) {
    let sAfter: string | undefined;
    for (let p = 0; p < MAX_PAGES; p++) {
      const page = await stripe.checkout.sessions.list({
        limit: PAGE_LIMIT, created: { gte },
        ...(sAfter ? { starting_after: sAfter } : {}),
      });
      for (const s of page.data) {
        if (s.payment_status !== "paid" || (s.amount_total ?? 0) <= 0) continue;
        if (!s.metadata?.type || !skip.has(s.metadata.type)) continue;
        const k = new Date(s.created * 1000).toISOString().slice(0, 10);
        let row = days.get(k);
        if (!row) { row = emptyDay(k); days.set(k, row); }
        row.non_platform_cents += s.amount_total ?? 0;
        row.non_platform_count++;
      }
      if (!page.has_more) break;
      sAfter = page.data[page.data.length - 1]?.id;
      if (!sAfter) break;
    }
  }

  for (const r of days.values()) {
    await sql`
      INSERT INTO stripe_daily_cache (
        day, gross_cents, fee_cents, refund_cents, adjustment_cents,
        other_fee_cents, charge_count, refund_count, adjustment_count,
        non_platform_cents, non_platform_count, updated_at
      ) VALUES (
        ${r.day}::date, ${r.gross_cents}, ${r.fee_cents}, ${r.refund_cents}, ${r.adjustment_cents},
        ${r.other_fee_cents}, ${r.charge_count}, ${r.refund_count}, ${r.adjustment_count},
        ${r.non_platform_cents}, ${r.non_platform_count}, now()
      )
      ON CONFLICT (day) DO UPDATE SET
        gross_cents = EXCLUDED.gross_cents,
        fee_cents = EXCLUDED.fee_cents,
        refund_cents = EXCLUDED.refund_cents,
        adjustment_cents = EXCLUDED.adjustment_cents,
        other_fee_cents = EXCLUDED.other_fee_cents,
        charge_count = EXCLUDED.charge_count,
        refund_count = EXCLUDED.refund_count,
        adjustment_count = EXCLUDED.adjustment_count,
        non_platform_cents = EXCLUDED.non_platform_cents,
        non_platform_count = EXCLUDED.non_platform_count,
        updated_at = now()
    `;
  }
}

/**
 * Window totals + a per-bucket series, from the day cache.
 */
export async function getStripeWindow(
  days: number | null,
  bucket: "day" | "week" | "month" = "day",
): Promise<StripeWindow | null> {
  const stripe = stripeClient();
  if (!stripe) return null;

  return cached(`window:${days}:${bucket}`, async () => {
    const from = days === null
      ? new Date(Date.UTC(2020, 0, 1))
      : new Date(Date.now() - days * 86400_000);

    await syncDailyCache(stripe, from);

    const sql = getDb();
    const fromDay = from.toISOString().slice(0, 10);
    const rows = (await sql`
      SELECT day::text AS day, gross_cents, fee_cents, refund_cents, adjustment_cents,
             other_fee_cents, charge_count, refund_count, adjustment_count,
             non_platform_cents, non_platform_count
      FROM stripe_daily_cache
      WHERE day >= ${fromDay}::date
      ORDER BY day
    `) as any[];

    const totals = {
      grossCents: 0, feeCents: 0, refundCents: 0, adjustmentCents: 0, otherFeeCents: 0,
      chargeCount: 0, refundCount: 0, adjustmentCount: 0,
      nonPlatformCents: 0, nonPlatformCount: 0,
    };
    const series = new Map<string, { day: string; gross: number; fee: number; refund: number; net: number }>();

    for (const r of rows) {
      const gross = Number(r.gross_cents);
      const fee = Number(r.fee_cents);
      const refund = Number(r.refund_cents);
      const adjustment = Number(r.adjustment_cents);
      const otherFee = Number(r.other_fee_cents);

      totals.grossCents += gross;
      totals.feeCents += fee;
      totals.refundCents += refund;
      totals.adjustmentCents += adjustment;
      totals.otherFeeCents += otherFee;
      totals.chargeCount += Number(r.charge_count);
      totals.refundCount += Number(r.refund_count);
      totals.adjustmentCount += Number(r.adjustment_count);
      const nonPlatform = Number(r.non_platform_cents ?? 0);
      totals.nonPlatformCents += nonPlatform;
      totals.nonPlatformCount += Number(r.non_platform_count ?? 0);

      const k = bucketKey(Math.floor(new Date(`${r.day}T00:00:00Z`).getTime() / 1000), bucket);
      let row = series.get(k);
      if (!row) { row = { day: k, gross: 0, fee: 0, refund: 0, net: 0 }; series.set(k, row); }
      // The series charts platform revenue, so non-platform charges come out.
      row.gross += gross - nonPlatform;
      row.fee += fee;
      row.refund += refund;
      row.net += gross - nonPlatform - fee - refund - adjustment - otherFee;
    }

    const netCents =
      totals.grossCents - totals.nonPlatformCents - totals.feeCents
      - totals.refundCents - totals.adjustmentCents - totals.otherFeeCents;
    const platformGrossCents = totals.grossCents - totals.nonPlatformCents;

    return {
      days,
      ...totals,
      platformGrossCents,
      netCents,
      effectiveFeeRate: platformGrossCents > 0 ? totals.feeCents / platformGrossCents : 0,
      series: Array.from(series.values()).sort((a, b) => a.day.localeCompare(b.day)),
      truncated: false,
    } satisfies StripeWindow;
  });
}

/**
 * Normalized MRR from live subscriptions.
 *
 * Read off the subscription items rather than off our own `users` table so it
 * reflects what Stripe will actually charge — including per-customer coupons
 * and yearly plans, both of which the DB's `subscription_tier` string loses.
 */
export async function getStripeMrr(): Promise<StripeMrr | null> {
  const stripe = stripeClient();
  if (!stripe) return null;

  return cached("mrr", async () => {
    const byInterval = new Map<string, { interval: string; count: number; mrrCents: number }>();
    const byPrice = new Map<string, { priceId: string; nickname: string; count: number; unitAmount: number; mrrCents: number }>();
    let activeCount = 0, mrrCents = 0, cancellingCount = 0, atRiskCents = 0;
    let startingAfter: string | undefined;
    let pages = 0;
    let truncated = false;

    for (;;) {
      const page = await stripe.subscriptions.list({
        status: "active",
        limit: PAGE_LIMIT,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of page.data) {
        activeCount++;
        let subMonthly = 0;
        for (const item of sub.items.data) {
          const price = item.price;
          const unit = price?.unit_amount ?? 0;
          const qty = item.quantity ?? 1;
          const rec = price?.recurring;
          if (!rec) continue;
          const per = rec.interval_count || 1;
          const monthly =
            rec.interval === "year" ? (unit * qty) / (12 * per)
            : rec.interval === "week" ? (unit * qty * 52) / (12 * per)
            : rec.interval === "day" ? (unit * qty * 365) / (12 * per)
            : (unit * qty) / per;
          subMonthly += monthly;

          const ik = rec.interval;
          const iEntry = byInterval.get(ik) ?? { interval: ik, count: 0, mrrCents: 0 };
          iEntry.count++; iEntry.mrrCents += monthly;
          byInterval.set(ik, iEntry);

          const pk = price?.id ?? "unknown";
          const pEntry = byPrice.get(pk) ?? {
            priceId: pk, nickname: price?.nickname || pk, count: 0, unitAmount: unit, mrrCents: 0,
          };
          pEntry.count++; pEntry.mrrCents += monthly;
          byPrice.set(pk, pEntry);
        }

        // A percent-off coupon applies to every item on the subscription.
        const discount = (sub as any).discount;
        const pct = discount?.coupon?.percent_off;
        if (typeof pct === "number") subMonthly *= 1 - pct / 100;

        mrrCents += subMonthly;
        // Stripe signals a pending cancellation two different ways —
        // cancel_at_period_end, or a concrete cancel_at timestamp — and the
        // portal uses both. Checking only the flag under-reported at-risk MRR
        // as $0 while our own users table showed 25 subscribers cancelling.
        if (sub.cancel_at_period_end || sub.cancel_at) { cancellingCount++; atRiskCents += subMonthly; }
      }

      pages++;
      if (!page.has_more || pages >= MAX_PAGES) { truncated = page.has_more === true; break; }
      startingAfter = page.data[page.data.length - 1]?.id;
      if (!startingAfter) break;
    }

    const round = (n: number) => Math.round(n);
    return {
      activeCount,
      mrrCents: round(mrrCents),
      arrCents: round(mrrCents * 12),
      cancellingCount,
      atRiskCents: round(atRiskCents),
      byInterval: Array.from(byInterval.values())
        .map((r) => ({ ...r, mrrCents: round(r.mrrCents) }))
        .sort((a, b) => b.mrrCents - a.mrrCents),
      byPrice: Array.from(byPrice.values())
        .map((r) => ({ ...r, mrrCents: round(r.mrrCents) }))
        .sort((a, b) => b.mrrCents - a.mrrCents),
      truncated,
    } satisfies StripeMrr;
  });
}

/** Current Stripe balance, for the "money in flight" card. */
export async function getStripeBalance(): Promise<StripeBalance | null> {
  const stripe = stripeClient();
  if (!stripe) return null;
  return cached("balance", async () => {
    const b = await stripe.balance.retrieve();
    const sum = (arr: { amount: number }[]) => arr.reduce((a, x) => a + x.amount, 0);
    return { availableCents: sum(b.available), pendingCents: sum(b.pending) } satisfies StripeBalance;
  });
}

/**
 * Charge-level rows for reconciliation against our `transactions` table.
 * Returns the Stripe checkout-session / payment-intent ids we can join on.
 */
export async function getStripeCharges(days: number | null): Promise<
  { id: string; paymentIntent: string | null; amount: number; refunded: number; created: number; email: string | null }[]
> {
  const stripe = stripeClient();
  if (!stripe) return [];

  return cached(`charges:${days}`, async () => {
    const since = days === null ? undefined : Math.floor(Date.now() / 1000) - days * 86400;
    const out: { id: string; paymentIntent: string | null; amount: number; refunded: number; created: number; email: string | null }[] = [];
    let startingAfter: string | undefined;
    let pages = 0;

    for (;;) {
      const page = await stripe.charges.list({
        limit: PAGE_LIMIT,
        ...(since ? { created: { gte: since } } : {}),
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const c of page.data) {
        if (c.status !== "succeeded") continue;
        out.push({
          id: c.id,
          paymentIntent: typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id ?? null,
          amount: c.amount,
          refunded: c.amount_refunded,
          created: c.created,
          email: c.billing_details?.email ?? c.receipt_email ?? null,
        });
      }
      pages++;
      if (!page.has_more || pages >= MAX_PAGES) break;
      startingAfter = page.data[page.data.length - 1]?.id;
      if (!startingAfter) break;
    }
    return out;
  });
}

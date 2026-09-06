/**
 * Subscription + XRGE holder discount helpers.
 *
 * Subscriptions: while `subscription_discount_pct > 0`, credit costs are reduced.
 * Holder tiers (see api/v1/_lib/xrge-holder.ts): additional discount stacks
 * multiplicatively with subscription — combined equivalent pct:
 *   combined = 100 - (100 - sub) * (100 - holder) / 100
 * Minimum cost stays 1 credit for paid actions (refund-safe).
 *
 * Pack purchases by subscribers get equivalent value via bonus credits in
 * the webhook (see api/webhook.ts).
 */

import { getDb } from "./db";
import { getHolderState } from "../v1/_lib/xrge-holder";

const cache = new Map<string, { pct: number; expires: number }>();
const combinedCache = new Map<string, { pct: number; expires: number }>();
const TTL_MS = 30_000;

/**
 * Subscription-only discount %. For combined sub + holder use getCombinedCreditDiscountPct.
 *
 * `users.subscription_discount_pct` is the single source of truth — the column
 * is `integer NOT NULL DEFAULT 0`, so it always has an answer.
 *
 * This used to read `(row?.pct ?? 0) || TIER_DISCOUNT_PCT[row.subscription_tier]`,
 * a per-tier fallback table holding the retired 15/30/50/70% ladder. Because 0
 * is falsy, an explicit 0 fell through to that table — so when subscriptions
 * moved to monthly bonus credits and all 117 subscribers were set to 0, every
 * one of them silently kept the old discount *as well as* the new credits, and
 * writing 0 could never take a discount away. The fallback was also
 * unreachable-by-design (NOT NULL), so it did nothing but resurrect retired
 * pricing. Removed rather than fixed: a value of 0 has to mean zero.
 *
 * A subscriber who should still get a per-generation discount carries it as a
 * positive value in the column.
 */
export async function getUserDiscountPct(userId: string): Promise<number> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.pct;

  try {
    const sql = getDb();
    const [row] = await sql`
      SELECT subscription_discount_pct::int AS pct
      FROM users WHERE id = ${userId}::uuid
    `;
    const pct = Math.max(0, Math.min(95, Number(row?.pct) || 0));
    cache.set(userId, { pct, expires: now + TTL_MS });
    return pct;
  } catch {
    return 0;
  }
}

/**
 * Effective credit discount % after stacking subscription + XRGE holder tier
 * (multiplicative). Cached briefly like subscription pct.
 */
export async function getCombinedCreditDiscountPct(userId: string): Promise<number> {
  const now = Date.now();
  const hit = combinedCache.get(userId);
  if (hit && hit.expires > now) return hit.pct;

  const sub = await getUserDiscountPct(userId);
  let holderPct = 0;
  try {
    const sql = getDb();
    const holder = await getHolderState(sql, userId);
    if (holder?.tier.id !== "none") holderPct = holder.effectiveDiscount;
  } catch (e: any) {
    console.warn("[discount] getHolderState failed:", e?.message);
  }

  const combined = 100 - (100 - sub) * (100 - holderPct) / 100;
  const pct = Math.max(0, Math.min(95, Math.round(combined * 10) / 10));
  combinedCache.set(userId, { pct, expires: now + TTL_MS });
  return pct;
}

/** Apply discount, never go below 1 credit for paid actions. */
export function applyDiscount(cost: number, pct: number): number {
  if (cost <= 0) return cost;
  if (!pct || pct <= 0) return cost;
  // Floor, not round, and definitely not ceil.
  //
  // Ceil gave low tiers nothing at all. Round was the fix for that, but it only
  // moved the problem: at 12.5% a 3-credit render is 2.625, and round() puts it
  // straight back to 3. Most images on this platform cost 3-4 credits, so an
  // Operative holder saw their discount on almost nothing they actually did —
  // it first became visible at 5 credits. Floor makes the advertised percentage
  // real at the sizes people generate at.
  const reduced = Math.floor(cost * (1 - pct / 100));
  return Math.max(1, reduced);
}

/** One-shot: resolve combined pct and return discounted cost. */
export async function discountedCost(userId: string, cost: number): Promise<{ cost: number; pct: number; original: number }> {
  const pct = await getCombinedCreditDiscountPct(userId);
  return { cost: applyDiscount(cost, pct), pct, original: cost };
}

/** Invalidate caches (call after subscription or holder tier changes). */
export function invalidateDiscount(userId: string) {
  cache.delete(userId);
  combinedCache.delete(userId);
}

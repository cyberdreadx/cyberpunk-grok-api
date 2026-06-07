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

const TIER_DISCOUNT_PCT: Record<string, number> = {
  basic: 15, "basic-yearly": 15,
  premium: 30, "premium-yearly": 30,
  pro: 50, "pro-yearly": 50,
  elite: 70, "elite-yearly": 70,
};

/**
 * Subscription-only discount %. For combined sub + holder use getCombinedCreditDiscountPct.
 */
export async function getUserDiscountPct(userId: string): Promise<number> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.pct;

  try {
    const sql = getDb();
    const [row] = await sql`
      SELECT subscription_tier, COALESCE(subscription_discount_pct, 0)::int AS pct
      FROM users WHERE id = ${userId}::uuid
    `;
    const fallbackPct = row?.subscription_tier ? (TIER_DISCOUNT_PCT[row.subscription_tier] || 0) : 0;
    const pct = Math.max(0, Math.min(95, (row?.pct ?? 0) || fallbackPct));
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
  // Round (not ceil) so low tiers actually get their advertised %: e.g. a 4-credit
  // image at 15% → round(3.4)=3, not ceil=4 (which delivered 0 discount).
  const reduced = Math.round(cost * (1 - pct / 100));
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

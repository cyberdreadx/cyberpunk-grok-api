/**
 * Subscription discount helper.
 *
 * Subscriptions no longer grant monthly credits; instead, while a user has
 * `subscription_discount_pct > 0` set on their row, every credit cost is
 * reduced by that percentage. Minimum cost is 1 credit (so we never bill 0
 * for a real generation, which would also break refund logic).
 *
 * Pack purchases by subscribers get equivalent value via bonus credits in
 * the webhook (see api/webhook.ts).
 */

import { getDb } from "./db";

const cache = new Map<string, { pct: number; expires: number }>();
const TTL_MS = 30_000;

/** Fetch and briefly cache a user's active discount %. 0 if no sub. */
export async function getUserDiscountPct(userId: string): Promise<number> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.pct;

  try {
    const sql = getDb();
    const [row] = await sql`
      SELECT COALESCE(subscription_discount_pct, 0)::int AS pct
      FROM users WHERE id = ${userId}::uuid
    `;
    const pct = Math.max(0, Math.min(95, row?.pct ?? 0));
    cache.set(userId, { pct, expires: now + TTL_MS });
    return pct;
  } catch {
    return 0;
  }
}

/** Apply discount, never go below 1 credit for paid actions. */
export function applyDiscount(cost: number, pct: number): number {
  if (cost <= 0) return cost;
  if (!pct || pct <= 0) return cost;
  const reduced = Math.ceil(cost * (1 - pct / 100));
  return Math.max(1, reduced);
}

/** One-shot: resolve user's pct and return discounted cost. */
export async function discountedCost(userId: string, cost: number): Promise<{ cost: number; pct: number; original: number }> {
  const pct = await getUserDiscountPct(userId);
  return { cost: applyDiscount(cost, pct), pct, original: cost };
}

/** Invalidate cache (call after sub changes via webhook if endpoint allows). */
export function invalidateDiscount(userId: string) {
  cache.delete(userId);
}

/**
 * Subscriber-only gate for free credits.
 *
 * Free credit sources (daily refill, spin wheel, daily missions) are
 * restricted to users with an active subscription. Paid actions
 * (credit packs, paid spin, generations using existing balance) are
 * unaffected.
 *
 * Reddit reward (api/reddit-reward.ts) is intentionally left open as a
 * one-time growth incentive.
 */

import { getDb } from "./db";

const cache = new Map<string, { sub: boolean; expires: number }>();
const TTL_MS = 30_000;

export const FREE_CREDITS_SUBSCRIBER_ONLY_MESSAGE =
  "Free credits (daily refill, spin wheel, daily missions) are now subscriber-only. Start any plan to unlock them — credit packs and existing balances are unaffected.";

export async function isSubscriber(userId: string): Promise<boolean> {
  if (!userId) return false;
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.sub;
  try {
    const sql = getDb();
    const [row] = await sql`
      SELECT subscription_tier FROM users WHERE id = ${userId}::uuid
    `;
    const sub = !!row?.subscription_tier;
    cache.set(userId, { sub, expires: now + TTL_MS });
    return sub;
  } catch {
    return false;
  }
}

export function invalidateSubscriberCache(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

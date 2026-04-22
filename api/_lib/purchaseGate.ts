import { hasKarmaUnlock, KARMA_THRESHOLD } from "./karma";

/**
 * Posting gate: users may post if they either
 *   (a) have made a real purchase (Stripe / XRGE), OR
 *   (b) have earned enough karma through engagement.
 *
 * Daily/spin/mission credits do NOT count as a purchase.
 */
export async function hasPurchased(sql: any, userId: string): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT
        stripe_customer_id,
        subscription_tier,
        COALESCE(xrge_lifetime_spend, 0)::numeric AS xrge_spend
      FROM users
      WHERE id = ${userId}::uuid
    `;
    if (!row) return false;
    if (row.stripe_customer_id) return true;
    if (row.subscription_tier) return true;
    if (parseFloat(row.xrge_spend || "0") > 0) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Combined posting eligibility: purchase OR karma path.
 */
export async function canPost(sql: any, userId: string): Promise<boolean> {
  if (await hasPurchased(sql, userId)) return true;
  const k = await hasKarmaUnlock(sql, userId);
  return k.ok;
}

export const POSTING_GATE_MESSAGE =
  `Posting requires either a credit purchase or ${KARMA_THRESHOLD} karma from community engagement (verified email + 48h account age). Earn karma by commenting, reacting, and receiving upvotes — or unlock instantly with any credit pack, subscription, or XRGE.`;

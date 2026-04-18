/**
 * Posting gate: only users who have made at least one real purchase
 * (Stripe subscription, Stripe pack, or XRGE purchase) may post to feed/stories.
 * Daily/spin/mission credits do NOT count.
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

export const POSTING_GATE_MESSAGE =
  "Posting to the community feed and stories requires a credit purchase. Buy any credit pack, subscription, or XRGE to unlock posting.";

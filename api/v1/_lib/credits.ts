/**
 * Shared credit helpers for v1 API endpoints.
 *
 * Uses GREATEST(..., 0) on UPDATE to prevent negative credits from race conditions.
 * Also exposes `applyDiscountToCost` so v1 endpoints can honor active subscriptions.
 */

import { applyDiscount } from "../../_lib/discount";

export interface CreditDeduction {
  dDaily: number;
  dSub: number;
  dPack: number;
}

/**
 * Apply the user's active subscription discount to a base cost.
 * `user` row should already include `subscription_discount_pct`.
 */
export function applyDiscountToCost(baseCost: number, user: any): number {
  const pct = Math.max(0, Math.min(95, parseInt(user?.subscription_discount_pct ?? 0, 10) || 0));
  return applyDiscount(baseCost, pct);
}

/**
 * Deduct credits from user's balance (daily -> sub -> pack).
 * Returns breakdown for potential refund. Throws on insufficient credits.
 */
export async function deductCredits(sql: any, userId: string, totalCost: number, _user?: any): Promise<CreditDeduction> {
  // Atomic deduction: CTE locks the row, computes the split, then UPDATE applies it.
  // WHERE guard on total prevents concurrent double-spend.
  const [row] = await sql`
    WITH snapshot AS (
      SELECT id, daily_credits, sub_credits, pack_credits
      FROM users
      WHERE id = ${userId}
        AND (daily_credits + sub_credits + pack_credits) >= ${totalCost}
      FOR UPDATE
    ), splits AS (
      SELECT
        LEAST(daily_credits, ${totalCost})::int AS d_daily,
        LEAST(sub_credits, GREATEST(${totalCost} - daily_credits, 0))::int AS d_sub,
        GREATEST(${totalCost} - daily_credits - sub_credits, 0)::int AS d_pack
      FROM snapshot
    )
    UPDATE users SET
      daily_credits = daily_credits - (SELECT d_daily FROM splits),
      sub_credits   = sub_credits   - (SELECT d_sub   FROM splits),
      pack_credits  = pack_credits  - (SELECT d_pack  FROM splits),
      updated_at = now()
    WHERE id = ${userId} AND EXISTS (SELECT 1 FROM snapshot)
    RETURNING
      (SELECT d_daily FROM splits) AS d_daily,
      (SELECT d_sub   FROM splits) AS d_sub,
      (SELECT d_pack  FROM splits) AS d_pack
  `;

  if (!row) {
    const [check] = await sql`SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${userId}`;
    if (!check) throw new Error("User not found");
    const total = (check.daily_credits || 0) + (check.sub_credits || 0) + (check.pack_credits || 0);
    throw new Error(`Insufficient credits. Need ${totalCost}, have ${total}`);
  }

  return { dDaily: row.d_daily || 0, dSub: row.d_sub || 0, dPack: row.d_pack || 0 };
}

export async function refundCredits(sql: any, userId: string, d: CreditDeduction) {
  await sql`
    UPDATE users SET
      daily_credits = daily_credits + ${d.dDaily},
      sub_credits = sub_credits + ${d.dSub},
      pack_credits = pack_credits + ${d.dPack},
      updated_at = now()
    WHERE id = ${userId}
  `;
}

export async function logUsage(sql: any, auth: any, action: string, totalCost: number, ip: string) {
  await sql`
    INSERT INTO api_usage_log (api_key_id, user_id, action, credits_used, ip_address)
    VALUES (${auth.apiKeyId}, ${auth.userId}, ${action}, ${totalCost}, ${ip})
  `;
  await sql`
    UPDATE api_keys SET total_credits = total_credits + ${totalCost} WHERE id = ${auth.apiKeyId}
  `;
}

export function getUserCredits(user: any): number {
  return (user.daily_credits || 0) + (user.sub_credits || 0) + (user.pack_credits || 0);
}

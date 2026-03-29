/**
 * Shared credit helpers for v1 API endpoints.
 *
 * Uses GREATEST(..., 0) on UPDATE to prevent negative credits from race conditions.
 */

export interface CreditDeduction {
  dDaily: number;
  dSub: number;
  dPack: number;
}

/**
 * Deduct credits from user's balance (daily -> sub -> pack).
 * Returns breakdown for potential refund. Throws on insufficient credits.
 */
export async function deductCredits(sql: any, userId: string, totalCost: number, _user?: any): Promise<CreditDeduction> {
  const [row] = await sql`
    SELECT daily_credits, sub_credits, pack_credits
    FROM users WHERE id = ${userId}
  `;
  if (!row) throw new Error("User not found");

  const daily = row.daily_credits || 0;
  const sub = row.sub_credits || 0;
  const pack = row.pack_credits || 0;
  const total = daily + sub + pack;

  if (total < totalCost) {
    throw new Error(`Insufficient credits. Need ${totalCost}, have ${total}`);
  }

  let remaining = totalCost;
  const dDaily = Math.min(remaining, daily); remaining -= dDaily;
  const dSub = Math.min(remaining, sub); remaining -= dSub;
  const dPack = remaining;

  await sql`
    UPDATE users SET
      daily_credits = GREATEST(daily_credits - ${dDaily}, 0),
      sub_credits = GREATEST(sub_credits - ${dSub}, 0),
      pack_credits = GREATEST(pack_credits - ${dPack}, 0),
      updated_at = now()
    WHERE id = ${userId}
  `;
  return { dDaily, dSub, dPack };
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

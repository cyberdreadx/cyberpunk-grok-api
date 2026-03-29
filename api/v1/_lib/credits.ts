/**
 * Shared credit helpers for v1 API endpoints.
 */

/** Deduct credits from user, returning the breakdown for potential refund. */
export async function deductCredits(sql: any, userId: string, totalCost: number, user: any) {
  let remaining = totalCost;
  const dDaily = Math.min(remaining, user.daily_credits || 0); remaining -= dDaily;
  const dSub = Math.min(remaining, user.sub_credits || 0); remaining -= dSub;
  const dPack = remaining;

  await sql`
    UPDATE users SET
      daily_credits = daily_credits - ${dDaily},
      sub_credits = sub_credits - ${dSub},
      pack_credits = pack_credits - ${dPack}
    WHERE id = ${userId}
  `;
  return { dDaily, dSub, dPack };
}

export async function refundCredits(sql: any, userId: string, d: { dDaily: number; dSub: number; dPack: number }) {
  await sql`
    UPDATE users SET
      daily_credits = daily_credits + ${d.dDaily},
      sub_credits = sub_credits + ${d.dSub},
      pack_credits = pack_credits + ${d.dPack}
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

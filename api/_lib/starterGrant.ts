/**
 * One-time starter credits, granted when a user verifies their email.
 *
 * Why it exists: since free credits went earn-only, a new account lands with
 * zero balance and no way to earn any before paying. Verified-signup →
 * ever-generated fell from ~90% to ~1%. This buys a handful of generations so
 * someone can see the product work once before the paywall.
 *
 * Why it's keyed on device and not account: per-account it's free GPU for
 * anyone willing to register twice, and 268 of the last 565 verified signups
 * came from a device that already had an account. One claim per device caps a
 * farmer at a single grant no matter how many addresses they burn.
 *
 * Verification is the gate that makes this affordable at all — generation
 * already requires a verified email, so an unclaimed throwaway can't spend it.
 */

import { getFreeCreditsConfig } from "./freeCredits";
import { logCreditGrant } from "./credit-ledger";

export interface StarterGrantResult {
  granted: boolean;
  credits: number;
  reason?: "disabled" | "already-claimed" | "device-claimed" | "error";
}

export async function grantStarterCredits(
  sql: any,
  userId: string,
  fingerprint: string | null | undefined,
): Promise<StarterGrantResult> {
  let credits = 0;
  try {
    const cfg = await getFreeCreditsConfig();
    if (!cfg.starter || cfg.starterCredits <= 0) {
      return { granted: false, credits: 0, reason: "disabled" };
    }
    credits = cfg.starterCredits;

    const fp = (fingerprint || "").trim() || null;

    // Claim first, credit second, in one statement. The UNIQUE constraints on
    // user_id and fingerprint are what make this idempotent — a replayed
    // verification or a second account on the same device inserts nothing and
    // therefore grants nothing.
    const [row] = await sql`
      WITH claim AS (
        INSERT INTO starter_grants (user_id, fingerprint, credits)
        VALUES (${userId}::uuid, ${fp}, ${credits})
        ON CONFLICT DO NOTHING
        RETURNING id, user_id, credits
      ), pay AS (
        UPDATE users u
        SET pack_credits = u.pack_credits + claim.credits, updated_at = now()
        FROM claim WHERE u.id = claim.user_id
        RETURNING u.id
      )
      SELECT EXISTS(SELECT 1 FROM claim) AS granted
    `;

    if (!row?.granted) {
      // Distinguish the two so admin can tell a repeat verification from a
      // device that has already been paid out.
      const [seen] = await sql`
        SELECT (user_id = ${userId}::uuid) AS same_user
        FROM starter_grants
        WHERE user_id = ${userId}::uuid OR (${fp}::text IS NOT NULL AND fingerprint = ${fp})
        LIMIT 1
      `;
      return {
        granted: false,
        credits: 0,
        reason: seen?.same_user ? "already-claimed" : "device-claimed",
      };
    }

    // Ledger is best-effort — the credits are already banked, and failing the
    // verification response over a bookkeeping row would be worse.
    await logCreditGrant(sql, userId, credits, "starter_grant", userId).catch(() => {});
    return { granted: true, credits };
  } catch (err: any) {
    console.error("[starter-grant]", err?.message);
    return { granted: false, credits: 0, reason: "error" };
  }
}

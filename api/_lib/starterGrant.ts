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
 *
 * Also keyed on the INBOX. The device key is a fingerprint the browser computes,
 * so it changes with the browser, profile or user agent, and farmers rotate it:
 * in the first weeks 49 inboxes collected more than one grant — 102 extra, 27%
 * of all grants — spread over N accounts on exactly N "devices". Plus-addressing
 * covered the email side. The inbox is the canonical address (+tags stripped,
 * Gmail dots collapsed), and a second account on an inbox already paid gets
 * nothing. Both accounts still exist and work; only the free credits are held
 * back, so this limits a promotion rather than deciding identity.
 */

import { getFreeCreditsConfig } from "./freeCredits";
import { logCreditGrant } from "./credit-ledger";
import { canonicalEmail } from "./email-canonical";

export interface StarterGrantResult {
  granted: boolean;
  credits: number;
  reason?: "disabled" | "already-claimed" | "device-claimed" | "inbox-claimed" | "error";
}

export async function grantStarterCredits(
  sql: any,
  userId: string,
  fingerprint: string | null | undefined,
  email?: string | null,
): Promise<StarterGrantResult> {
  let credits = 0;
  try {
    const cfg = await getFreeCreditsConfig();
    if (!cfg.starter || cfg.starterCredits <= 0) {
      return { granted: false, credits: 0, reason: "disabled" };
    }
    credits = cfg.starterCredits;

    const fp = (fingerprint || "").trim() || null;
    // canonicalEmail returns "" for anything unparseable. Store NULL instead, so
    // two unparseable addresses can never collide in the unique index.
    const mailbox = canonicalEmail(email) || null;

    // Claim first, credit second, in one statement. The UNIQUE constraints on
    // user_id, fingerprint and mailbox are what make this idempotent — a replayed
    // verification, a second account on the same device, or a second account on
    // an inbox already paid inserts nothing and therefore grants nothing.
    // ON CONFLICT with no target covers all three.
    const [row] = await sql`
      WITH claim AS (
        INSERT INTO starter_grants (user_id, fingerprint, mailbox, credits)
        VALUES (${userId}::uuid, ${fp}, ${mailbox}, ${credits})
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
      // Distinguish the three so admin can tell a repeat verification from a
      // device already paid out from an inbox already paid out. COALESCE because
      // a grant whose account was deleted has a NULL user_id, and NULL = x is
      // NULL rather than false.
      const [seen] = await sql`
        SELECT COALESCE(user_id = ${userId}::uuid, false) AS same_user,
               COALESCE(fingerprint = ${fp}::text, false) AS same_device
        FROM starter_grants
        WHERE user_id = ${userId}::uuid
           OR (${fp}::text IS NOT NULL AND fingerprint = ${fp})
           OR (${mailbox}::text IS NOT NULL AND mailbox = ${mailbox})
        ORDER BY COALESCE(user_id = ${userId}::uuid, false) DESC,
                 COALESCE(fingerprint = ${fp}::text, false) DESC
        LIMIT 1
      `;
      return {
        granted: false,
        credits: 0,
        reason: seen?.same_user ? "already-claimed" : seen?.same_device ? "device-claimed" : "inbox-claimed",
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

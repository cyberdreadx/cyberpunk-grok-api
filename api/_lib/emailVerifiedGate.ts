/**
 * Email-verification gate for generation.
 *
 * Nothing checked `email_verified` before a job ran, so an address nobody
 * proved they own could burn GPU time. That's the cheapest possible abuse
 * path: sign up with a throwaway, generate, repeat. It's also what makes
 * per-account limits meaningful at all — a limit on an unverified account is
 * a limit on nothing.
 *
 * Distinct from verifiedGate.ts, which is *creator identity* verification
 * (Stripe Identity + a monthly subscription) and gates monetization. This one
 * is only "did you click the link in your email".
 *
 * Admins bypass, so a misconfigured admin account can never lock itself out of
 * the tools it needs to fix the problem.
 */

import { getDb } from "./db";

export const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Verify your email before generating. Check your inbox for the 6-digit code — you can resend it from the header.";

/** Machine-readable code so the UI can open the verification prompt directly. */
export const EMAIL_VERIFICATION_REQUIRED_CODE = "EMAIL_VERIFICATION_REQUIRED";

// Generation is a hot path relative to how rarely this answer changes, and it
// only ever flips once per account. Short TTL so a just-verified user isn't
// told to verify again.
const cache = new Map<string, { ok: boolean; expires: number }>();
const TTL_MS = 30_000;

/** Clear a user's cached verdict — call right after they verify. */
export function clearEmailVerifiedCache(userId: string): void {
  cache.delete(userId);
}

export async function isEmailVerified(userId: string, sql?: any): Promise<boolean> {
  if (!userId) return false;
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.ok;

  try {
    const db = sql ?? getDb();
    const [row] = await db`
      SELECT email_verified, is_admin FROM users WHERE id = ${userId}::uuid
    `;
    const ok = !!row && (!!row.email_verified || !!row.is_admin);
    cache.set(userId, { ok, expires: now + TTL_MS });
    return ok;
  } catch {
    // Fail OPEN. A database blip must not take generation down for everyone;
    // the worst case is that an unverified account slips one job through,
    // which is a far smaller problem than a site-wide outage.
    return true;
  }
}

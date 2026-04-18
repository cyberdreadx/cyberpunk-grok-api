/**
 * Verification gate — only verified creators with an ACTIVE monthly
 * verification subscription may set lock prices on new posts/stories
 * and request new payouts.
 *
 * Hard cutoff: status must be 'verified' AND verification_renews_at must be
 * in the future (Stripe sets this from invoice.paid). 'lapsed' = revoked.
 */

export const VERIFICATION_REQUIRED_MESSAGE =
  "Identity verification is required to monetize content or request payouts. Complete the one-time ID check + monthly verification subscription to enable.";

export async function isVerified(sql: any, userId: string): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT verification_status, verification_renews_at
      FROM users
      WHERE id = ${userId}::uuid
    `;
    if (!row) return false;
    if (row.verification_status !== "verified") return false;
    // If we have a renews_at, it must still be in the future. If null, accept
    // (just verified, before first invoice.paid fires).
    if (row.verification_renews_at && new Date(row.verification_renews_at) <= new Date()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

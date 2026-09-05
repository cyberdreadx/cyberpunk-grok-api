/**
 * Canonical form of an email address, for deciding whether two addresses reach
 * the same person.
 *
 * Only for that question. It must never be used for account identity or
 * uniqueness — users@ and users+work@ are legitimately separate accounts and
 * always have been, and collapsing them would lock people out of accounts they
 * already own.
 *
 * The case this exists for: referral attribution compared raw strings, so
 * referring yourself cost one plus sign. 139 of 5,396 referrals on record are
 * a user referring their own alias. That was tolerable when the reward was
 * credits; the ambassador program pays cash on attribution.
 */

/** Providers that route every dotted spelling of a local part to one mailbox. */
const DOT_INSENSITIVE = new Set(["gmail.com", "googlemail.com"]);

/** Domains that are the same mailbox under a different name. */
const DOMAIN_ALIASES: Record<string, string> = {
  "googlemail.com": "gmail.com",
};

/**
 * Reduce an address to the mailbox it actually reaches.
 *
 * Sub-addressing (`+tag`) is stripped everywhere: it is near-universal across
 * Gmail, Outlook, Proton, Fastmail and iCloud, and an address issued with a
 * literal plus in it is vanishingly rare — whereas a self-referral using one is
 * demonstrably not. Dots are only collapsed for providers that genuinely ignore
 * them, since elsewhere first.last@ and firstlast@ are different people.
 *
 * Returns "" for anything that isn't parseable, so callers can treat an
 * unusable address as "no match" rather than accidentally matching everything.
 */
export function canonicalEmail(input: unknown): string {
  const raw = String(input ?? "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return "";

  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);

  domain = DOMAIN_ALIASES[domain] ?? domain;

  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  // A local part that is nothing but a tag ("+foo@") has no mailbox to reduce to.
  if (plus === 0) return "";

  if (DOT_INSENSITIVE.has(domain)) local = local.replace(/\./g, "");

  return local && domain ? `${local}@${domain}` : "";
}

/**
 * Do these two addresses reach the same person?
 *
 * Falls back to a literal comparison when either address won't canonicalise, so
 * a malformed address can never be treated as matching an unrelated one.
 */
export function sameMailbox(a: unknown, b: unknown): boolean {
  const ca = canonicalEmail(a);
  const cb = canonicalEmail(b);
  if (!ca || !cb) {
    return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  }
  return ca === cb;
}

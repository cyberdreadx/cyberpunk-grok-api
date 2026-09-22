/**
 * Block throwaway mail by the mail server behind the domain, not the domain name.
 *
 * A farm operator registers a fresh domain whenever the last one gets blocked —
 * gonrr.net and vtmpj.com are the same service under two names — but they keep
 * pointing at the same mail host. Checking MX catches the next domain before it
 * has a single account on it.
 *
 * WHY THIS LIST IS SHORT, AND MUST STAY SHORT: most shared mail hosts serve real
 * customers too. The obvious candidates here were mail.wallywatts.com and
 * mail.wabblywabble.com — until a check showed 15 PAYING customers on domains
 * behind exactly those two hosts (4heats.com, bultoc.com, ryzid.com and more).
 * Blocking the host would have turned away paying users. Only a host whose whole
 * business is disposable addresses belongs here, and
 * scripts/check-blocklist-safety.mts must pass before adding one.
 */

import { promises as dns } from "node:dns";

/** Matched against the end of each MX hostname, so subdomains are covered. */
const BLOCKED_MX_HOSTS: string[] = [
  "10minutemail.com",
];

const TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 1500;
const cache = new Map<string, { blocked: boolean; until: number }>();

export function isBlockedMxHost(exchange: string): boolean {
  const host = String(exchange || "").toLowerCase().replace(/\.$/, "");
  return BLOCKED_MX_HOSTS.some((b) => host === b || host.endsWith("." + b));
}

/**
 * Resolves the domain's MX records and reports whether they belong to a known
 * disposable-mail service.
 *
 * Fails OPEN. A DNS hiccup must never block a real signup, so any error, timeout
 * or empty answer returns false — the domain blocklist and the velocity cap are
 * still in front of it.
 */
export async function isDisposableByMx(email: string): Promise<boolean> {
  const domain = String(email || "").toLowerCase().trim().split("@")[1];
  if (!domain) return false;

  const hit = cache.get(domain);
  if (hit && hit.until > Date.now()) return hit.blocked;

  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("mx timeout")), LOOKUP_TIMEOUT_MS)),
    ]);
    const blocked = Array.isArray(records) && records.some((r) => isBlockedMxHost(r.exchange));
    cache.set(domain, { blocked, until: Date.now() + TTL_MS });
    return blocked;
  } catch {
    // Unresolvable or slow: not our call to make here.
    cache.set(domain, { blocked: false, until: Date.now() + NEGATIVE_TTL_MS });
    return false;
  }
}

/** For the safety checker. */
export function blockedMxHosts(): string[] {
  return [...BLOCKED_MX_HOSTS];
}

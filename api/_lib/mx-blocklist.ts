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
  // 2026-10-18, each checked against payers (scripts/check-blocklist-safety.mts):
  "tempamail.com",    // ozvmail.com, mailfrs.com, ogzmail.com — the 7-account farm that claimed the treasury wallet
  "mail.tm",          // public temp-mail API (uberip.com, emalupe.com, maxxspace.com)
  "edu-mails.com",    // "Temp Mail – Free Temporary Email & Edumail": fake .edu.pl / .org.uk inboxes
  "kuromee.com",      // gozora.site, kuromee.store, *.cyou — 10 domains, mostly device-shared
  "laoia.com",        // 52 accounts, 38 on shared devices, no payers
  "emailinbo.live",   // 36 accounts, 33 on shared devices, no payers
  "phuturemail.com",  // 12 accounts, 11 on shared devices, no payers
  "duckzmail.com",    // duckz.me, reelduckz.com, ezaiapi.com
];

/**
 * Mail hosts that may sign up but get no free starter credits.
 *
 * wallywatts / wabblywabble serve 340+ rotating domains and ~5,900 accounts,
 * mostly credit farms — but 16 paying customers too ($597 lifetime, 0.7% of
 * revenue, as of 2026-10-18), which is why they aren't in BLOCKED_MX_HOSTS.
 * Holding back the giveaway removes the farmers' reason to come while the
 * rare real buyer signs up and pays as normal.
 */
const NO_STARTER_MX_HOSTS: string[] = [
  "wallywatts.com",
  "wabblywabble.com",
];

const TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 1500;
const cache = new Map<string, { blocked: boolean; until: number }>();

function hostIn(list: string[], exchange: string): boolean {
  const host = String(exchange || "").toLowerCase().replace(/\.$/, "");
  return list.some((b) => host === b || host.endsWith("." + b));
}

export function isBlockedMxHost(exchange: string): boolean {
  return hostIn(BLOCKED_MX_HOSTS, exchange);
}

const mxCache = new Map<string, { hosts: string[]; until: number }>();

/** The domain's MX hostnames; [] on any DNS trouble (callers fail open). */
async function mxHosts(email: string): Promise<string[]> {
  const domain = String(email || "").toLowerCase().trim().split("@")[1];
  if (!domain) return [];
  const hit = mxCache.get(domain);
  if (hit && hit.until > Date.now()) return hit.hosts;
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("mx timeout")), LOOKUP_TIMEOUT_MS)),
    ]);
    const hosts = Array.isArray(records) ? records.map((r) => r.exchange) : [];
    mxCache.set(domain, { hosts, until: Date.now() + TTL_MS });
    return hosts;
  } catch {
    mxCache.set(domain, { hosts: [], until: Date.now() + NEGATIVE_TTL_MS });
    return [];
  }
}

/** True when the address's mail host is on NO_STARTER_MX_HOSTS. Fails open (false). */
export async function isNoStarterByMx(email: string): Promise<boolean> {
  return (await mxHosts(email)).some((h) => hostIn(NO_STARTER_MX_HOSTS, h));
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

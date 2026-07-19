/**
 * Signup domain-velocity guard.
 *
 * The 2026-07 farming wave rotated catch-all custom domains faster than the
 * disposable-domain blocklist could be updated (each new domain burned ~5-250
 * accounts before being spotted). Instead of chasing domains, cap how many
 * accounts any single non-mainstream domain can create in a rolling window:
 * legit users arrive on big providers (allowlisted below, never limited);
 * a custom domain producing many signups in a week is a catch-all farm.
 *
 * Deleted accounts count toward the cap so delete→recreate cycles don't reset it.
 */
import type { getDb } from "./db";

/** Major providers exempt from the velocity cap. */
const MAINSTREAM_PROVIDERS = new Set<string>([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "outlook.de", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "live.co.uk",
  "yahoo.com", "ymail.com", "rocketmail.com",
  "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.es", "yahoo.it", "yahoo.ca",
  "yahoo.com.br", "yahoo.co.in", "yahoo.co.jp",
  "icloud.com", "me.com", "mac.com",
  "aol.com",
  "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.de", "gmx.net", "web.de", "mail.com", "t-online.de",
  "mail.ru", "yandex.com", "yandex.ru",
  "zoho.com", "fastmail.com", "tutanota.com", "tuta.io", "tuta.com",
  "duck.com", "hey.com",
  "qq.com", "163.com", "126.com", "naver.com", "daum.net", "hanmail.net",
  "orange.fr", "free.fr", "wanadoo.fr", "laposte.net", "sfr.fr",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "cox.net",
  "charter.net", "bellsouth.net", "earthlink.net",
  "shaw.ca", "rogers.com", "sympatico.ca",
  "btinternet.com", "sky.com", "virginmedia.com",
  "libero.it", "tiscali.it", "seznam.cz", "wp.pl", "o2.pl", "interia.pl",
  "onet.pl", "abv.bg", "ukr.net", "rediffmail.com",
  // Small privacy providers with real paying GLTCH customers — do not limit.
  "shieldedpost.net", "atomicmail.io",
]);

const WINDOW_DAYS = 7;

function maxPerWindow(): number {
  const n = Number(process.env.SIGNUP_DOMAIN_MAX_7D);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * Returns true when signups from this domain should be blocked.
 * `domain` must already be lowercased (signup normalizes the email first).
 */
export async function isDomainVelocityExceeded(
  sql: ReturnType<typeof getDb>,
  domain: string,
): Promise<boolean> {
  if (MAINSTREAM_PROVIDERS.has(domain)) return false;
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*) FROM users
        WHERE split_part(email, '@', 2) = ${domain}
          AND created_at > now() - make_interval(days => ${WINDOW_DAYS})) AS live,
      (SELECT COUNT(*) FROM deleted_accounts
        WHERE split_part(email, '@', 2) = ${domain}
          AND deleted_at > now() - make_interval(days => ${WINDOW_DAYS})) AS tombstoned
  `;
  const recent = Number(row?.live ?? 0) + Number(row?.tombstoned ?? 0);
  return recent >= maxPerWindow();
}

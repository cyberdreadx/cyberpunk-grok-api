/**
 * Referral / ambassador attribution capture.
 *
 * `?ref=CODE` was previously read straight off window.location at the moment
 * the auth dialog mounted. That works only if someone signs up on the exact
 * pageview they arrived on — click a link, browse two pages, then register and
 * the code is gone, because SPA navigation drops the query string. Fine when
 * the reward was 10 credits; not fine now that attribution decides who gets
 * paid cash.
 *
 * So the code is persisted on arrival and survives until it's used or expires.
 */

import { API_BASE_URL } from "./api";

const KEY = "gltch-ref";
/** Standard affiliate attribution window. */
const TTL_DAYS = 30;

interface StoredRef {
  code: string;
  at: number;
}

/** Read the stored code, ignoring (and clearing) anything past its window. */
export function getStoredRef(): string | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredRef;
    if (!parsed?.code) return undefined;
    if (Date.now() - parsed.at > TTL_DAYS * 86400_000) {
      localStorage.removeItem(KEY);
      return undefined;
    }
    return parsed.code;
  } catch {
    return undefined;
  }
}

/** Clear attribution once it has been consumed by a successful signup. */
export function clearStoredRef(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private browsing */
  }
}

/**
 * Adopt a referral code: persist it and count the click.
 *
 * First touch wins — a second ambassador's link doesn't overwrite the one that
 * actually introduced someone to the site. Returns the code now in force.
 */
export function adoptRefCode(raw: string | null | undefined): string | undefined {
  const code = raw?.trim().toUpperCase() || undefined;
  const existing = getStoredRef();
  if (!code) return existing;

  if (!existing) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() } satisfies StoredRef));
    } catch {
      /* private browsing — attribution still works for this pageview */
    }
  }

  // Count the visit. Fire-and-forget: a blocked or failed ping must never
  // interfere with the page loading.
  try {
    void fetch(`${API_BASE_URL}/ambassador`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "track", code }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }

  return existing || code;
}

/** Capture `?ref=` from the current URL. Call once, as early as possible. */
export function captureRefFromUrl(): string | undefined {
  try {
    return adoptRefCode(new URLSearchParams(window.location.search).get("ref"));
  } catch {
    return getStoredRef();
  }
}

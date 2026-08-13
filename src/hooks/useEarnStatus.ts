/**
 * One shared read of "what can this user earn, and where are they in the
 * funnel" — used by every earn/referral promo surface.
 *
 * Promo placements are scattered across the nav, the feed, the create page,
 * the credit dialog and the profile. Each fetching for itself would mean four
 * or five round trips per page load, and `/referral get-code` is a write (it
 * mints a code on first call), so it especially shouldn't fire per component.
 * The in-flight promise is shared and the result cached for the session.
 */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { BRAND } from "@/lib/brand";

export interface EarnStatus {
  code: string | null;
  link: string;
  totalReferred: number;
  totalPurchased: number;
  creditsEarned: number;
  freeMonthsEarned: number;
  /** Approved ambassador — earns cash, not just credits. */
  isAmbassador: boolean;
  ambassadorCode: string | null;
  ambassadorStatus: string | null;
  commissionPct: number | null;
  /** pending | approved | rejected | null */
  applicationStatus: string | null;
}

const EMPTY: EarnStatus = {
  code: null, link: "", totalReferred: 0, totalPurchased: 0, creditsEarned: 0,
  freeMonthsEarned: 0, isAmbassador: false, ambassadorCode: null,
  ambassadorStatus: null, commissionPct: null, applicationStatus: null,
};

const CACHE_KEY = "gltch-earn-status";
let inflight: Promise<EarnStatus> | null = null;
let cached: EarnStatus | null = null;

function readSession(): EarnStatus | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as EarnStatus) : null;
  } catch {
    return null;
  }
}

async function fetchStatus(): Promise<EarnStatus> {
  const [codeRes, statsRes, mineRes] = await Promise.allSettled([
    apiFetch<{ code: string }>("/referral", { method: "POST", body: { action: "get-code" } }),
    apiFetch<any>("/referral", { method: "POST", body: { action: "stats" } }),
    apiFetch<any>("/ambassador", { method: "POST", body: { action: "mine" } }),
  ]);

  const code = codeRes.status === "fulfilled" ? codeRes.value?.code ?? null : null;
  const stats = statsRes.status === "fulfilled" ? statsRes.value : null;
  const mine = mineRes.status === "fulfilled" ? mineRes.value : null;
  const amb = mine?.ambassador ?? null;

  const status: EarnStatus = {
    code,
    // An approved ambassador's vanity code takes precedence — it's the link
    // that pays cash, and showing them the old hex code would route their
    // audience through the credits-only path.
    link: amb?.code ? `${BRAND.publicUrl}/r/${amb.code}` : code ? `${BRAND.publicUrl}/r/${code}` : "",
    totalReferred: stats?.totalReferred ?? 0,
    totalPurchased: stats?.totalPurchased ?? 0,
    creditsEarned: stats?.creditsEarned ?? 0,
    freeMonthsEarned: stats?.freeMonthsEarned ?? 0,
    isAmbassador: !!amb,
    ambassadorCode: amb?.code ?? null,
    ambassadorStatus: amb?.status ?? null,
    commissionPct: amb?.commissionPct ?? null,
    applicationStatus: mine?.application?.status ?? null,
  };

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(status));
  } catch {
    /* private browsing */
  }
  cached = status;
  return status;
}

/** Drop the cache so the next read reflects a just-changed state. */
export function refreshEarnStatus(): void {
  cached = null;
  inflight = null;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function useEarnStatus(enabled: boolean): { status: EarnStatus; loading: boolean } {
  const [status, setStatus] = useState<EarnStatus>(() => cached ?? readSession() ?? EMPTY);
  const [loading, setLoading] = useState(!cached && enabled);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    if (cached) { setStatus(cached); setLoading(false); return; }

    let alive = true;
    inflight = inflight ?? fetchStatus();
    inflight
      .then((s) => { if (alive) { setStatus(s); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); })
      .finally(() => { inflight = null; });
    return () => { alive = false; };
  }, [enabled]);

  return { status, loading };
}

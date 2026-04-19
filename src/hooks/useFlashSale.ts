/**
 * useFlashSale — polls /api/flash-sales for the currently active sale
 * and exposes a live countdown. Returns null when no sale is active.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface FlashSale {
  id: string;
  title: string;
  discount_percent: number;
  bonus_credits_percent: number;
  packages: string[] | null;
  starts_at: string;
  ends_at: string;
  max_uses: number | null;
  uses: number;
}

let cached: { sale: FlashSale | null; ts: number } | null = null;
const CACHE_MS = 30_000;

export function useFlashSale() {
  const [sale, setSale] = useState<FlashSale | null>(cached?.sale ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await apiFetch("/flash-sales");
        const next: FlashSale | null = r?.sales?.[0] ?? null;
        cached = { sale: next, ts: Date.now() };
        if (!cancelled) setSale(next);
      } catch {
        if (!cancelled) setSale(null);
      }
    };
    if (!cached || Date.now() - cached.ts > CACHE_MS) load();
    const poll = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(poll); };
  }, []);

  useEffect(() => {
    if (!sale) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sale]);

  if (!sale) return { sale: null, timeLeft: "", expired: false, appliesTo: () => false };

  const endMs = new Date(sale.ends_at).getTime();
  const diff = Math.max(0, endMs - now);
  const expired = diff <= 0;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const timeLeft = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;

  const appliesTo = (packageId: string) =>
    !sale.packages || sale.packages.length === 0 || sale.packages.includes(packageId);

  return { sale, timeLeft, expired, appliesTo };
}

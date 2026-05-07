/**
 * Global kill switch for all free-credit sources (daily reset, spin wheel,
 * daily missions). Reddit posting reward (api/reddit-reward.ts) is
 * intentionally NOT gated by this flag — it remains active.
 *
 * Resolution order (first match wins):
 *   1. FREE_CREDITS_DISABLED=true env var → forces DISABLED
 *   2. DB override in app_config.key='free_credits' → { enabled: bool }
 *   3. FREE_CREDITS_ENABLED env var (default: false → DISABLED)
 *
 * Admins can flip the DB override at runtime via /api/admin/free-credits.
 */
import { getDb } from "./db";

const CACHE_TTL_MS = 5_000;
let cache: { value: boolean; expiresAt: number } | null = null;

function envForcedDisabled(): boolean {
  const v = (process.env.FREE_CREDITS_DISABLED || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

function envEnabled(): boolean {
  const v = (process.env.FREE_CREDITS_ENABLED || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Returns true if free credits are currently disabled. DB-backed with a short
 * in-memory cache to avoid hammering Postgres on every request.
 */
export async function freeCreditsDisabled(): Promise<boolean> {
  if (envForcedDisabled()) return true;

  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  let dbEnabled: boolean | null = null;
  try {
    const sql = getDb();
    const rows = await sql`SELECT value FROM app_config WHERE key = 'free_credits'`;
    const row = rows[0] as { value: any } | undefined;
    if (row?.value != null) {
      const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      if (v && typeof v.enabled === "boolean") dbEnabled = v.enabled;
    }
  } catch (e) {
    console.warn("[freeCredits] DB read failed:", (e as Error).message);
  }

  const enabled = dbEnabled !== null ? dbEnabled : envEnabled();
  const disabled = !enabled;
  cache = { value: disabled, expiresAt: now + CACHE_TTL_MS };
  return disabled;
}

/** Invalidate the in-memory cache (call after admin updates the flag). */
export function invalidateFreeCreditsCache(): void {
  cache = null;
}

export const FREE_CREDITS_MAINTENANCE_MESSAGE =
  "Free credits are temporarily paused. Paid credits and subscriptions are unaffected — check back soon.";

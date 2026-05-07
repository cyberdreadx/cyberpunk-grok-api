/**
 * Per-source kill switches for free-credit grants. Reddit posting reward
 * (api/reddit-reward.ts) is intentionally NOT gated and always remains active.
 *
 * Sources:
 *   - daily    → cron-reset-daily.ts (daily credit refill)
 *   - spin     → spin.ts (free spin wheel)
 *   - missions → daily-missions.ts (daily mission rewards + streak bonus)
 *
 * Configuration (app_config row, key='free_credits'):
 *   { master?: bool, daily?: bool, spin?: bool, missions?: bool }
 *
 * A source is ENABLED if its per-source flag is true, OR if it's unset and
 * master is true. Forced-disable env var overrides everything.
 *
 * Resolution order (first match wins for "disabled"):
 *   1. FREE_CREDITS_DISABLED=true env var → all sources DISABLED
 *   2. DB per-source flag (if explicitly set)
 *   3. DB master flag
 *   4. FREE_CREDITS_ENABLED env var (default: false → DISABLED)
 */
import { getDb } from "./db";

export type FreeCreditSource = "daily" | "spin" | "missions";
export const ALL_SOURCES: FreeCreditSource[] = ["daily", "spin", "missions"];

export interface FreeCreditsConfig {
  master: boolean;
  daily: boolean;
  spin: boolean;
  missions: boolean;
}

const CACHE_TTL_MS = 5_000;
let cache: { value: FreeCreditsConfig; expiresAt: number } | null = null;

function envForcedDisabled(): boolean {
  const v = (process.env.FREE_CREDITS_DISABLED || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

function envEnabled(): boolean {
  const v = (process.env.FREE_CREDITS_ENABLED || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Loads per-source config from DB (cached). */
export async function getFreeCreditsConfig(): Promise<FreeCreditsConfig> {
  if (envForcedDisabled()) {
    return { master: false, daily: false, spin: false, missions: false };
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  let dbMaster: boolean | null = null;
  let dbDaily: boolean | null = null;
  let dbSpin: boolean | null = null;
  let dbMissions: boolean | null = null;

  try {
    const sql = getDb();
    const rows = await sql`SELECT value FROM app_config WHERE key = 'free_credits'`;
    const row = rows[0] as { value: any } | undefined;
    if (row?.value != null) {
      const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      if (v && typeof v === "object") {
        // Back-compat: legacy { enabled: bool } shape → maps to master.
        if (typeof v.enabled === "boolean" && typeof v.master !== "boolean") {
          dbMaster = v.enabled;
        }
        dbMaster = asBool(v.master) ?? dbMaster;
        dbDaily = asBool(v.daily);
        dbSpin = asBool(v.spin);
        dbMissions = asBool(v.missions);
      }
    }
  } catch (e) {
    console.warn("[freeCredits] DB read failed:", (e as Error).message);
  }

  const masterEnabled = dbMaster !== null ? dbMaster : envEnabled();
  const config: FreeCreditsConfig = {
    master: masterEnabled,
    daily: dbDaily !== null ? dbDaily : masterEnabled,
    spin: dbSpin !== null ? dbSpin : masterEnabled,
    missions: dbMissions !== null ? dbMissions : masterEnabled,
  };
  cache = { value: config, expiresAt: now + CACHE_TTL_MS };
  return config;
}

/** Returns true if a specific reward source is disabled. */
export async function isSourceDisabled(source: FreeCreditSource): Promise<boolean> {
  const cfg = await getFreeCreditsConfig();
  return !cfg[source];
}

/**
 * Master switch: returns true if ALL free-credit sources are disabled.
 * Kept for back-compat. New code should prefer `isSourceDisabled(source)`.
 */
export async function freeCreditsDisabled(): Promise<boolean> {
  const cfg = await getFreeCreditsConfig();
  return !cfg.daily && !cfg.spin && !cfg.missions;
}

/** Invalidate the in-memory cache (call after admin updates the flag). */
export function invalidateFreeCreditsCache(): void {
  cache = null;
}

export const FREE_CREDITS_MAINTENANCE_MESSAGE =
  "Free credits are temporarily paused. Paid credits and subscriptions are unaffected — check back soon.";

/** Per-source maintenance messages, used by API endpoints to explain state. */
export const SOURCE_LABEL: Record<FreeCreditSource, string> = {
  daily: "Daily free credit refill",
  spin: "Free spin wheel",
  missions: "Daily missions",
};

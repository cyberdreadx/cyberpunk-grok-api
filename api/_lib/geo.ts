/**
 * Region lookup and legal geo-blocking.
 *
 * Minnesota's 2025 nudification statute reaches services made available in the
 * state, and GLTCH's edit flow is squarely in scope, so requests from blocked
 * regions are refused rather than served.
 *
 * The block list lives in app_config, not in this file, so scope can change
 * without a deploy — that matters because the right scope is a legal question
 * and may narrow (edit endpoints only) or widen (more states) on advice.
 *
 * Lookups hit a local DB-IP City Lite database: no per-request network call, no
 * API key, no rate limit, and no user IP leaving the box to a third party.
 */

import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./db";
import { getClientIp } from "./ratelimit";

export const GEO_BLOCK_KEY = "geo_blocks";

/** ISO 3166-2-ish "US-MN". Kept as a plain string so config stays readable. */
export type RegionCode = string;

export interface GeoBlockConfig {
  enabled: boolean;
  /** Regions refused outright, e.g. ["US-MN"]. */
  regions: RegionCode[];
  /**
   * When set, only these workflow/route families are refused for blocked
   * regions; everything else is allowed through. Empty means block everything,
   * which is the safer default until a lawyer narrows it.
   */
  restrictTo: string[];
  message: string;
}

export const GEO_DEFAULTS: GeoBlockConfig = {
  enabled: true,
  regions: ["US-MN"],
  restrictTo: [],
  message:
    "GLTCH is not available in your region for legal reasons. If you believe this is an error, contact support.",
};

/**
 * US state name → code.
 *
 * DB-IP's free tier ships subdivisions but strips `iso_code`, leaving only the
 * English name — so "US-MN" has to be reconstructed from "Minnesota". The paid
 * tiers and MaxMind both include iso_code, and lookupRegion prefers it when
 * present, so swapping in a fuller database later needs no code change.
 */
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
};

// ── database ──────────────────────────────────────────────────────────────

const DB_PATH = join(process.cwd(), "data", "dbip-city-lite.mmdb");

type Reader = { get(ip: string): any };
let reader: Reader | null = null;
let readerTried = false;
let loadedMtime = 0;
let lastStat = 0;

/** How often to notice that the monthly refresh has swapped the file in. */
const STAT_INTERVAL_MS = 10 * 60_000;

/**
 * The database is replaced monthly by scripts/refresh-geo-db.sh. Watching its
 * mtime means that swap takes effect on its own — a restart to pick up a geo
 * database would drop in-flight generation polls for no good reason.
 */
function shouldReload(): boolean {
  if (Date.now() - lastStat < STAT_INTERVAL_MS) return false;
  lastStat = Date.now();
  try {
    return statSync(DB_PATH).mtimeMs !== loadedMtime;
  } catch {
    return false;
  }
}

function getReader(): Reader | null {
  if (readerTried && !shouldReload()) return reader;
  readerTried = true;
  try {
    if (!existsSync(DB_PATH)) {
      console.warn(`[geo] no database at ${DB_PATH} — geo blocking is INACTIVE`);
      return null;
    }
    loadedMtime = statSync(DB_PATH).mtimeMs;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mm = require("maxmind");
    const MMReader = mm.Reader || mm.default?.Reader;
    if (!MMReader) throw new Error("maxmind Reader not found");
    reader = new MMReader(readFileSync(DB_PATH));
    console.log("[geo] region database loaded");
  } catch (err: any) {
    console.error("[geo] failed to load database:", err?.message);
    reader = null;
  }
  return reader;
}

/**
 * Resolve an IP to "US-MN" style, or null when unknown.
 *
 * Unknown is deliberately not blocked. A VPN, a proxy or a gap in the database
 * would otherwise lock out paying customers in unrelated places, and the volume
 * of that far exceeds the handful of blocked-region users an IP check was ever
 * going to stop.
 */
export function lookupRegion(ip: string): RegionCode | null {
  const r = getReader();
  if (!r || !ip || ip === "unknown") return null;
  try {
    const rec = r.get(ip);
    const country = rec?.country?.iso_code;
    if (!country) return null;

    const sub0 = rec?.subdivisions?.[0];
    let sub: string | undefined = sub0?.iso_code;
    if (!sub && country === "US") {
      const name = String(sub0?.names?.en || "").toLowerCase().trim();
      sub = US_STATES[name];
    }
    return sub ? `${country}-${sub}` : country;
  } catch {
    return null;
  }
}

// ── config ────────────────────────────────────────────────────────────────

let cached: { at: number; cfg: GeoBlockConfig } | null = null;
const TTL_MS = 60_000;

export async function getGeoConfig(): Promise<GeoBlockConfig> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.cfg;
  try {
    const rows = await getDb()`SELECT value FROM app_config WHERE key = ${GEO_BLOCK_KEY} LIMIT 1`;
    const raw = (rows[0] as { value: unknown } | undefined)?.value;
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<GeoBlockConfig> | null;
    const cfg: GeoBlockConfig = {
      enabled: v?.enabled ?? GEO_DEFAULTS.enabled,
      regions: Array.isArray(v?.regions)
        ? v!.regions.map((x) => String(x).toUpperCase().trim()).filter(Boolean)
        : GEO_DEFAULTS.regions,
      restrictTo: Array.isArray(v?.restrictTo) ? v!.restrictTo.map(String) : GEO_DEFAULTS.restrictTo,
      message: typeof v?.message === "string" && v.message ? v.message : GEO_DEFAULTS.message,
    };
    cached = { at: Date.now(), cfg };
    return cfg;
  } catch {
    return GEO_DEFAULTS;
  }
}

// ── enforcement ───────────────────────────────────────────────────────────

export interface GeoVerdict {
  blocked: boolean;
  region: RegionCode | null;
  message: string;
}

/**
 * Should this request be refused?
 *
 * `family` names what is being attempted ("edit", "generate", "signup"). It only
 * matters when restrictTo is non-empty — the narrow mode where a state bans one
 * capability rather than the service.
 */
export async function checkGeo(req: VercelRequest, family = "*"): Promise<GeoVerdict> {
  const cfg = await getGeoConfig();
  const region = lookupRegion(getClientIp(req));
  if (!cfg.enabled || !region) return { blocked: false, region, message: "" };

  const inBlockedRegion = cfg.regions.includes(region);
  if (!inBlockedRegion) return { blocked: false, region, message: "" };

  const familyBlocked = cfg.restrictTo.length === 0 || cfg.restrictTo.includes(family);
  return { blocked: familyBlocked, region, message: cfg.message };
}

/**
 * Refuse the request if the region is blocked. Returns true when it has already
 * responded, so callers read: `if (await enforceGeo(req, res, "edit")) return;`
 *
 * 451 rather than 403 — this is a legal restriction, not an authorisation
 * failure, and the distinction is worth making in the logs.
 */
export async function enforceGeo(
  req: VercelRequest,
  res: VercelResponse,
  family = "*",
): Promise<boolean> {
  const v = await checkGeo(req, family);
  if (!v.blocked) return false;
  console.warn(`[geo] refused ${family} from ${v.region}`);
  res.status(451).json({ error: v.message, code: "region_blocked", region: v.region });
  return true;
}

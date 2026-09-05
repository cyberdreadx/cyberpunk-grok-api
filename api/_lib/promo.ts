/**
 * Anti-farm promo — config, eligibility, and URL normalisation.
 *
 * Shared by api/promo-claim.ts (the claimant) and api/admin/promo.ts (the
 * reviewer) so both judge eligibility by exactly the same rules. The database
 * enforces the rules that must never bend (one payout per user, one claim per
 * post) via partial unique indexes in migration 061; this file holds the ones
 * that are policy and may be tuned.
 */

import { createHash } from "crypto";
import { getDb } from "./db";

export const PROMO_KEY = "antifarm_promo";
export const ANTIREDDIT_HOSTS = ["antireddit.com", "www.antireddit.com"];

export interface PromoConfig {
  enabled: boolean;
  maxApproved: number;
  creditAmount: number;
  minAccountAgeDays: number;
  minRenders: number;
  requireCode: boolean;
  /** Hostnames a claim link may point at. Editable so a new community can be
   *  added without a deploy — which matters now that this promo is the main way
   *  GLTCH reaches new people rather than a side channel. */
  allowedHosts: string[];
}

export const PROMO_DEFAULTS: PromoConfig = {
  enabled: true,
  maxApproved: 20,
  creditAmount: 25,
  minAccountAgeDays: 7,
  minRenders: 3,
  requireCode: true,
  allowedHosts: ANTIREDDIT_HOSTS,
};

/** Lowercase, strip scheme/path/port, drop junk. Keeps app_config sane. */
export function cleanHosts(input: unknown, fallback: string[]): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,]+/) : null;
  if (!list) return fallback;
  const out: string[] = [];
  for (const raw of list) {
    const h = String(raw ?? "")
      .trim().toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[/:].*$/, "");
    // A bare TLD or something with no dot is not a host worth trusting.
    if (h && h.length <= 253 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !out.includes(h)) {
      out.push(h);
    }
  }
  return out.length ? out.slice(0, 25) : fallback;
}

export async function getPromoConfig(): Promise<PromoConfig> {
  try {
    const sql = getDb();
    const rows = await sql`SELECT value FROM app_config WHERE key = ${PROMO_KEY} LIMIT 1`;
    const raw = (rows[0] as { value: unknown } | undefined)?.value;
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<PromoConfig> | null;
    if (!v || typeof v !== "object") return PROMO_DEFAULTS;
    return {
      enabled: v.enabled ?? PROMO_DEFAULTS.enabled,
      // Coerce and clamp: a bad hand-edit of app_config must not mint credits
      // or uncap the promo.
      maxApproved: clamp(v.maxApproved, PROMO_DEFAULTS.maxApproved, 0, 1000),
      creditAmount: clamp(v.creditAmount, PROMO_DEFAULTS.creditAmount, 0, 500),
      minAccountAgeDays: clamp(v.minAccountAgeDays, PROMO_DEFAULTS.minAccountAgeDays, 0, 365),
      minRenders: clamp(v.minRenders, PROMO_DEFAULTS.minRenders, 0, 10000),
      requireCode: v.requireCode ?? PROMO_DEFAULTS.requireCode,
      allowedHosts: cleanHosts(v.allowedHosts, PROMO_DEFAULTS.allowedHosts),
    };
  } catch {
    return PROMO_DEFAULTS;
  }
}

function clamp(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/**
 * Normalise a promo post URL for duplicate detection.
 *
 * Returns null if it isn't a post link on one of the allowed hosts — which is
 * also the "empty post" guard, since a blank or junk string cannot parse into
 * one. Query strings and fragments are dropped so ?utm_source=… cannot be used
 * to submit the same post twice.
 *
 * The stored value keeps its host, so widening allowedHosts later never
 * collides with links already claimed under the old list.
 */
export function normalizePostUrl(input: string, hosts: string[] = ANTIREDDIT_HOSTS): string | null {
  const raw = (input || "").trim();
  if (!raw || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!hosts.includes(u.hostname.toLowerCase())) return null;
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  // A bare host, or /a/gltchrunner with no post after it, is not a post.
  if (path.length < 2) return null;
  return `${u.hostname.toLowerCase()}${path}`;
}

export interface Eligibility {
  eligible: boolean;
  accountAgeDays: number;
  renderCount: number;
  alreadyPaid: boolean;
  reasons: string[];
}

/**
 * What counts as a completed render: any paid generation that was not refunded.
 * usage_log carries non-render rows too (chat-message, share, moderation-*,
 * goodwill-*), so the families are listed rather than counting every row.
 */
export async function getEligibility(userId: string, cfg: PromoConfig): Promise<Eligibility> {
  const sql = getDb();
  const [row] = await sql`
    SELECT
      EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400 AS age_days,
      (
        SELECT count(*) FROM usage_log l
        WHERE l.user_id = u.id
          AND l.credits_used > 0
          AND l.mode NOT LIKE '%refunded%'
          AND (l.mode LIKE 'comfy-%' OR l.mode LIKE 'generate-%'
               OR l.mode LIKE 'edit-%' OR l.mode LIKE 'gltch-edit%')
      ) AS renders,
      EXISTS (
        SELECT 1 FROM promo_claims c
        WHERE c.user_id = u.id AND c.status = 'approved'
      ) AS already_paid
    FROM users u WHERE u.id = ${userId}::uuid
  ` as any[];

  if (!row) {
    return { eligible: false, accountAgeDays: 0, renderCount: 0, alreadyPaid: false, reasons: ["Account not found"] };
  }

  const accountAgeDays = Math.floor(Number(row.age_days) || 0);
  const renderCount = Number(row.renders) || 0;
  const alreadyPaid = !!row.already_paid;

  const reasons: string[] = [];
  if (alreadyPaid) reasons.push("This account already received the promo");
  if (accountAgeDays < cfg.minAccountAgeDays) {
    reasons.push(`Account is ${accountAgeDays} day${accountAgeDays === 1 ? "" : "s"} old — needs ${cfg.minAccountAgeDays}`);
  }
  if (renderCount < cfg.minRenders) {
    reasons.push(`${renderCount} render${renderCount === 1 ? "" : "s"} so far — needs ${cfg.minRenders}`);
  }

  return { eligible: reasons.length === 0, accountAgeDays, renderCount, alreadyPaid, reasons };
}

/** Payouts already made. The promo closes itself when this reaches maxApproved. */
export async function approvedCount(): Promise<number> {
  const sql = getDb();
  const [row] = await sql`SELECT count(*)::int AS n FROM promo_claims WHERE status = 'approved'` as any[];
  return Number(row?.n) || 0;
}

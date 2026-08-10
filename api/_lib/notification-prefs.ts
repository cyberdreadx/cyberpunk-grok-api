/**
 * Email notification preferences, unsubscribe tokens, and the send throttle.
 *
 * Unsubscribe links are STATELESS: the token is an HMAC of the user id keyed by
 * JWT_SECRET, so there is no token table to write on every send and no row to
 * look up on every click. It also can't expire out from under someone who
 * unsubscribes from a six-month-old email — which is exactly the case where a
 * dead link turns into a spam complaint.
 */

import crypto from "crypto";
import { getDb } from "./db";

/** Notification types that may be emailed, and whether they are on by default. */
export const DEFAULT_EMAIL_TYPES: Record<string, boolean> = {
  comment: true,
  follow: true,
  unlock: true,   // someone paid for their content — always worth an email
  dm: true,       // reserved for the DM system
  system: true,
  upvote: false,  // high volume, low signal
  credits: false, // daily grant — the site already shows this
};

/** Minimum gap between emails of the same type to the same user. */
const THROTTLE_SECONDS: Record<string, number> = {
  comment: 3600,
  follow: 3600,
  upvote: 21600,
  unlock: 900,
  dm: 900,
  credits: 86400,
  system: 300,
};
const DEFAULT_THROTTLE_SECONDS = 3600;

export interface NotificationPrefs {
  emailEnabled: boolean;
  types: Record<string, boolean>;
}

let ensured = false;
async function ensureTables(sql: any) {
  if (ensured) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS notification_prefs (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_enabled boolean NOT NULL DEFAULT true,
        types jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS notification_email_throttle (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type text NOT NULL,
        last_sent_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, type)
      )
    `;
    ensured = true;
  } catch (e) {
    console.error("[notification-prefs] ensureTables failed", e);
  }
}

/** Effective prefs for a user, with code defaults filled in. */
export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  const sql = getDb();
  await ensureTables(sql);
  try {
    const [row] = await sql`
      SELECT email_enabled, types FROM notification_prefs WHERE user_id = ${userId}::uuid
    `;
    const overrides = (row?.types as Record<string, boolean>) || {};
    return {
      emailEnabled: row ? !!row.email_enabled : true,
      types: { ...DEFAULT_EMAIL_TYPES, ...overrides },
    };
  } catch {
    return { emailEnabled: true, types: { ...DEFAULT_EMAIL_TYPES } };
  }
}

/** Merge a partial update into a user's prefs. */
export async function setPrefs(
  userId: string,
  update: { emailEnabled?: boolean; types?: Record<string, boolean> },
): Promise<void> {
  const sql = getDb();
  await ensureTables(sql);

  // Only keys we actually recognise — this is written from a user-supplied body.
  const clean: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(update.types || {})) {
    if (k in DEFAULT_EMAIL_TYPES) clean[k] = !!v;
  }

  // Single statement: jsonb || jsonb merges overrides without a read-then-write
  // race (the Neon HTTP driver autocommits, so there is no transaction to hold).
  await sql`
    INSERT INTO notification_prefs (user_id, email_enabled, types, updated_at)
    VALUES (
      ${userId}::uuid,
      ${update.emailEnabled ?? true},
      ${JSON.stringify(clean)}::jsonb,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
      SET email_enabled = COALESCE(${update.emailEnabled ?? null}::boolean, notification_prefs.email_enabled),
          types = notification_prefs.types || ${JSON.stringify(clean)}::jsonb,
          updated_at = now()
  `;
}

/**
 * Atomically claim a send slot. Returns true if this call may send.
 *
 * The DO UPDATE ... WHERE only fires when the previous send is old enough; if it
 * doesn't fire, no row comes back and we're throttled. One statement, no race —
 * same reasoning as _lib/ratelimit.ts.
 */
export async function claimEmailSlot(userId: string, type: string): Promise<boolean> {
  const sql = getDb();
  await ensureTables(sql);
  const secs = THROTTLE_SECONDS[type] ?? DEFAULT_THROTTLE_SECONDS;
  try {
    const rows = await sql`
      INSERT INTO notification_email_throttle (user_id, type, last_sent_at)
      VALUES (${userId}::uuid, ${type}, now())
      ON CONFLICT (user_id, type) DO UPDATE
        SET last_sent_at = now()
        WHERE notification_email_throttle.last_sent_at < now() - make_interval(secs => ${secs})
      RETURNING user_id
    `;
    return (rows as any[]).length > 0;
  } catch (e) {
    console.error("[notification-prefs] claimEmailSlot failed", e);
    return false; // fail closed — better a missed email than a loop
  }
}

/* ── Stateless unsubscribe tokens ──────────────────────────────────────── */

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Token proving the holder controls this user's email link. `type` is optional
 *  and scopes the unsubscribe to a single notification type. */
export function makeUnsubToken(userId: string, type = "*"): string {
  const payload = `${userId}:${type}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyUnsubToken(token: string): { userId: string; type: string } | null {
  try {
    const [body, mac] = String(token).split(".");
    if (!body || !mac) return null;
    const payload = Buffer.from(body, "base64url").toString("utf8");
    const expected = sign(payload);
    // Constant-time compare — lengths must match first or timingSafeEqual throws.
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const idx = payload.lastIndexOf(":");
    if (idx < 0) return null;
    return { userId: payload.slice(0, idx), type: payload.slice(idx + 1) };
  } catch {
    return null;
  }
}

/**
 * Base host for API links that must work from OUTSIDE the app.
 *
 * NOT SITE_URL. SITE_URL is the marketing/SPA domain (gltchrunner.com), where
 * `/api/*` is a Netlify proxy — and if that proxy is stale or misconfigured the
 * path falls through to index.html and silently renders the app instead of
 * unsubscribing. An unsubscribe link that appears to work but doesn't is worse
 * than no link at all: the user clicks, keeps getting mail, and reports spam.
 * Point straight at the API origin.
 */
export function apiPublicBase(): string {
  return process.env.API_PUBLIC_URL || "https://api.gltch.app";
}

export function unsubUrl(userId: string, type = "*"): string {
  return `${apiPublicBase()}/api/unsubscribe?token=${encodeURIComponent(makeUnsubToken(userId, type))}`;
}

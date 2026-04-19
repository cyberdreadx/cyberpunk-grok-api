/**
 * Trusted device cookie helpers for 2FA "remember this device" (30 days).
 */
import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./db";

const COOKIE_NAME = "td";
const TTL_DAYS = 30;

function hash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Cache the schema-ensure promise so we don't run DDL on every request
// (running ALTER/CREATE on every login was causing intermittent failures
// and slow responses that surfaced as "Load failed" on the client).
let _ensurePromise: Promise<void> | null = null;
export async function ensureTrustedDevicesTable() {
  if (_ensurePromise) return _ensurePromise;
  const sql = getDb();
  _ensurePromise = (async () => {
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_code TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_code_expires_at TIMESTAMPTZ`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_attempts INT NOT NULL DEFAULT 0`;
      await sql`CREATE TABLE IF NOT EXISTS trusted_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        user_agent TEXT,
        ip TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )`;
    } catch (e) {
      // Reset cache so a future call can retry, but don't block login.
      _ensurePromise = null;
      console.error("[trustedDevice] ensure schema failed", (e as any)?.message);
    }
  })();
  return _ensurePromise;
}

function parseCookies(req: VercelRequest): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

export function readTrustedDeviceCookie(req: VercelRequest): string | null {
  return parseCookies(req)[COOKIE_NAME] || null;
}

export async function isDeviceTrusted(req: VercelRequest, userId: string): Promise<boolean> {
  const token = readTrustedDeviceCookie(req);
  if (!token) return false;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT 1 FROM trusted_devices
      WHERE user_id = ${userId}::uuid AND token_hash = ${hash(token)} AND expires_at > now()
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function issueTrustedDevice(res: VercelResponse, req: VercelRequest, userId: string): Promise<void> {
  await ensureTrustedDevicesTable();
  const token = crypto.randomBytes(32).toString("hex");
  const ua = (req.headers["user-agent"] || "").toString().slice(0, 500);
  const ip = ((req.headers["x-forwarded-for"] as string) || "").split(",")[0].trim() || null;
  const sql = getDb();
  await sql`
    INSERT INTO trusted_devices (user_id, token_hash, user_agent, ip, expires_at)
    VALUES (${userId}::uuid, ${hash(token)}, ${ua}, ${ip}, now() + (${TTL_DAYS} || ' days')::interval)
  `.catch((e) => { console.error("[trustedDevice] insert failed", (e as any)?.message); });
  const maxAge = TTL_DAYS * 24 * 60 * 60;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
  );
}

export async function revokeTrustedDevices(userId: string): Promise<void> {
  try {
    const sql = getDb();
    await sql`DELETE FROM trusted_devices WHERE user_id = ${userId}::uuid`;
  } catch {}
}

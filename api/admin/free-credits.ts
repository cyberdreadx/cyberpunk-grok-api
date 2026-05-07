/**
 * /api/admin/free-credits — admin-only kill switch for free credits.
 *
 * GET  → { enabled, source, envForcedDisabled, envEnabled }
 * POST { enabled: boolean } → updates the DB override and returns new state.
 *
 * Note: the FREE_CREDITS_DISABLED env var (if set) overrides the DB and
 * cannot be cleared from this endpoint. The admin UI surfaces that fact.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "../_lib/auth";
import { applyCors } from "../_lib/cors";
import { invalidateFreeCreditsCache } from "../_lib/freeCredits";

const KEY = "free_credits";

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

function envForcedDisabled(): boolean {
  const v = (process.env.FREE_CREDITS_DISABLED || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

function envEnabled(): boolean {
  const v = (process.env.FREE_CREDITS_ENABLED || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

async function readDbOverride(): Promise<boolean | null> {
  try {
    const sql = getDb();
    const rows = await sql`SELECT value FROM app_config WHERE key = ${KEY}`;
    const row = rows[0] as { value: any } | undefined;
    if (!row || row.value == null) return null;
    const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    return typeof v?.enabled === "boolean" ? v.enabled : null;
  } catch (e) {
    console.warn("[admin/free-credits] read failed:", (e as Error).message);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Access denied" });
  }

  if (req.method === "GET") {
    const dbOverride = await readDbOverride();
    const forcedDisabled = envForcedDisabled();
    const enabled = forcedDisabled
      ? false
      : dbOverride !== null
      ? dbOverride
      : envEnabled();
    return res.status(200).json({
      enabled,
      source: forcedDisabled ? "env_forced_disabled" : dbOverride !== null ? "db" : "env_default",
      dbOverride,
      envForcedDisabled: forcedDisabled,
      envEnabled: envEnabled(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "Body must be { enabled: boolean }" });
  }

  try {
    const sql = getDb();
    const payload = JSON.stringify({ enabled, updated_at: new Date().toISOString() });
    await sql`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (${KEY}, ${payload}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
    invalidateFreeCreditsCache();
    const forcedDisabled = envForcedDisabled();
    return res.status(200).json({
      ok: true,
      enabled: forcedDisabled ? false : enabled,
      effective: forcedDisabled ? "env_forced_disabled" : "db",
      envForcedDisabled: forcedDisabled,
    });
  } catch (e: any) {
    console.error("[admin/free-credits]", e.message);
    return res.status(500).json({ error: "Failed to update free-credits flag" });
  }
}

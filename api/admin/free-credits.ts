/**
 * /api/admin/free-credits — admin-only kill switch for free credits.
 *
 * GET  → { master, daily, spin, missions, source, envForcedDisabled, envEnabled }
 * POST { master?, daily?, spin?, missions? } → updates DB override (any subset).
 *
 * Reddit posting reward is NEVER gated by this endpoint.
 *
 * If FREE_CREDITS_DISABLED env var is set, all sources are forced off and the
 * UI override is ignored.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "../_lib/auth";
import { applyCors } from "../_lib/cors";
import { invalidateFreeCreditsCache, getFreeCreditsConfig } from "../_lib/freeCredits";

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

async function readDbRaw(): Promise<Record<string, unknown> | null> {
  try {
    const sql = getDb();
    const rows = await sql`SELECT value FROM app_config WHERE key = ${KEY}`;
    const row = rows[0] as { value: any } | undefined;
    if (!row || row.value == null) return null;
    return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
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
    const cfg = await getFreeCreditsConfig();
    const dbRaw = await readDbRaw();
    return res.status(200).json({
      master: cfg.master,
      daily: cfg.daily,
      spin: cfg.spin,
      missions: cfg.missions,
      reddit: true, // always-on, included for UI clarity
      envForcedDisabled: envForcedDisabled(),
      envEnabled: envEnabled(),
      dbRaw,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const updates: Record<string, boolean> = {};
  for (const k of ["master", "daily", "spin", "missions"]) {
    if (typeof body[k] === "boolean") updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      error: "Body must include at least one boolean: master, daily, spin, missions.",
    });
  }

  try {
    const existing = (await readDbRaw()) || {};
    // Strip legacy `enabled` field — we use `master` going forward.
    const { enabled: _legacy, ...rest } = existing as any;
    const merged = {
      ...rest,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    const sql = getDb();
    const payload = JSON.stringify(merged);
    await sql`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (${KEY}, ${payload}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
    invalidateFreeCreditsCache();
    const cfg = await getFreeCreditsConfig();
    return res.status(200).json({
      ok: true,
      master: cfg.master,
      daily: cfg.daily,
      spin: cfg.spin,
      missions: cfg.missions,
      envForcedDisabled: envForcedDisabled(),
    });
  } catch (e: any) {
    console.error("[admin/free-credits]", e.message);
    return res.status(500).json({ error: "Failed to update free-credits flag" });
  }
}

/**
 * GET  /api/immersion — public: returns master UI immersion JSON (for all visitors).
 * POST /api/immersion — admin only: saves master immersion (applies globally).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";

export const config = { maxDuration: 10 };

const KEY = "immersion_ui";

const DEFAULT = {
  flicker: 0.35,
  pulseHz: 0.7,
  redShift: 8,
  glow: 0.85,
  scanline: 0.16,
  vignette: 0.4,
};

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseImmersion(raw: unknown): typeof DEFAULT {
  if (!raw || typeof raw !== "object") return { ...DEFAULT };
  const o = raw as Record<string, unknown>;
  return {
    flicker: clamp(Number(o.flicker), 0, 1, DEFAULT.flicker),
    pulseHz: clamp(Number(o.pulseHz), 0.05, 30, DEFAULT.pulseHz),
    redShift: clamp(Number(o.redShift), 0, 30, DEFAULT.redShift),
    glow: clamp(Number(o.glow), 0, 2, DEFAULT.glow),
    scanline: clamp(Number(o.scanline), 0, 1, DEFAULT.scanline),
    vignette: clamp(Number(o.vignette), 0, 1, DEFAULT.vignette),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const sql = getDb();
      const rows = await sql`SELECT value FROM app_config WHERE key = ${KEY}`;
      const row = rows[0] as { value: unknown } | undefined;
      if (row?.value != null) {
        const parsed = parseImmersion(
          typeof row.value === "string" ? JSON.parse(row.value) : row.value,
        );
        res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
        return res.status(200).json(parsed);
      }
    } catch (e) {
      console.warn("[immersion] GET DB fallback:", (e as Error).message);
    }
    return res.status(200).json({ ...DEFAULT });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const body = parseImmersion(req.body);
    const sql = getDb();
    const payload = JSON.stringify(body);
    await sql`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (${KEY}, ${payload}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `;
    return res.status(200).json({ ok: true, immersion: body });
  } catch (e) {
    console.error("[immersion] POST:", e);
    return res.status(500).json({ error: (e as Error).message || "Save failed" });
  }
}

/**
 * /api/media-errors
 *
 * POST (public, optionally auth): log a single failed media URL from the client.
 *   body: { url, kind: 'image'|'video', source?: string }
 *   - rate-limited per-IP via simple in-memory counter (best-effort)
 *   - hostname & extension are derived server-side so the client can't lie
 *
 * GET (admin only): aggregate dashboard for the last N days.
 *   ?days=7 → { total, byHost, byExt, recent: [...] }
 *
 * Backed by `media_errors` table (migration 038).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { applyCors } from "./_lib/cors";

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

// Tiny per-IP rate limit (best-effort, per warm lambda).
const HITS = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = HITS.get(ip);
  if (!cur || cur.reset < now) {
    HITS.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > MAX_PER_WINDOW;
}

function deriveHostExt(rawUrl: string): { host: string; ext: string } | null {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.toLowerCase();
    const m = path.match(/\.([a-z0-9]{1,8})(?:$|\?)/);
    return { host: u.hostname, ext: m ? m[1] : "" };
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();

  // ─── POST: log an error ────────────────────────────────────────────────
  if (req.method === "POST") {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (rateLimited(ip)) return res.status(429).json({ error: "rate-limited" });

    const { url, kind, source } = (req.body || {}) as { url?: string; kind?: string; source?: string };
    if (!url || typeof url !== "string" || url.length > 2000) {
      return res.status(400).json({ error: "invalid url" });
    }
    if (kind !== "image" && kind !== "video") {
      return res.status(400).json({ error: "invalid kind" });
    }
    const parsed = deriveHostExt(url);
    if (!parsed) return res.status(400).json({ error: "unparseable url" });

    const auth = getUserFromRequest(req);
    const ua = (req.headers["user-agent"] as string || "").slice(0, 500);
    const src = (typeof source === "string" ? source : "feed-card").slice(0, 64);

    try {
      await sql`
        INSERT INTO media_errors (url, host, ext, kind, source, user_id, user_agent)
        VALUES (${url.slice(0, 2000)}, ${parsed.host}, ${parsed.ext}, ${kind}, ${src}, ${auth?.userId || null}, ${ua})
      `;
      return res.status(200).json({ ok: true });
    } catch (e: any) {
      // Table may not exist yet on a freshly-cloned env — soft-fail so
      // client error reporters never spam server logs with 500s.
      console.warn("[media-errors] insert failed:", e?.message);
      return res.status(200).json({ ok: false, soft: true });
    }
  }

  // ─── GET: admin dashboard ──────────────────────────────────────────────
  if (req.method === "GET") {
    if (!isAdmin(req)) return res.status(403).json({ error: "Access denied" });
    const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "7"), 10) || 7));

    try {
      const [{ count: total } = { count: 0 }] = await sql`
        SELECT count(*)::int AS count FROM media_errors
        WHERE created_at > now() - (${days} || ' days')::interval
      `;
      const byHost = await sql`
        SELECT host, kind, count(*)::int AS count
        FROM media_errors
        WHERE created_at > now() - (${days} || ' days')::interval
        GROUP BY host, kind ORDER BY count DESC LIMIT 30
      `;
      const byExt = await sql`
        SELECT ext, kind, count(*)::int AS count
        FROM media_errors
        WHERE created_at > now() - (${days} || ' days')::interval
        GROUP BY ext, kind ORDER BY count DESC LIMIT 20
      `;
      const recent = await sql`
        SELECT id, url, host, ext, kind, source, created_at
        FROM media_errors
        WHERE created_at > now() - (${days} || ' days')::interval
        ORDER BY created_at DESC LIMIT 50
      `;
      const topUrls = await sql`
        SELECT url, host, ext, kind, count(*)::int AS count, max(created_at) AS last_seen
        FROM media_errors
        WHERE created_at > now() - (${days} || ' days')::interval
        GROUP BY url, host, ext, kind
        ORDER BY count DESC LIMIT 25
      `;
      return res.status(200).json({ total, days, byHost, byExt, topUrls, recent });
    } catch (e: any) {
      return res.status(200).json({
        total: 0, days, byHost: [], byExt: [], topUrls: [], recent: [],
        warning: `Table not ready: ${e?.message || "unknown"}`,
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

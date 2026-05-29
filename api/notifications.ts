/**
 * /api/notifications – Notification inbox
 *
 * GET  → list notifications (paginated, newest first)
 * PATCH → mark as read { ids: string[] } or { all: true }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { checkRateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "notifications", { max: 60, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();

  // Self-heal: make sure the table exists even if migration 023 wasn't run.
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type text NOT NULL,
        title text NOT NULL,
        body text,
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        actor_username text,
        actor_avatar_url text,
        ref_id text,
        read boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  } catch (e) {
    console.error("[notifications] ensure table failed", e);
  }

  /* ── GET: list notifications ──────────────────────────── */
  if (req.method === "GET") {
    const limit = Math.min(parseInt(String(req.query.limit)) || 30, 100);
    const offset = parseInt(String(req.query.offset)) || 0;

    try {
      const rows = await sql`
        SELECT id, type, title, body, actor_username, actor_avatar_url, ref_id, read, created_at
        FROM notifications
        WHERE user_id = ${auth.userId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [{ count }] = await sql`
        SELECT count(*)::int AS count FROM notifications
        WHERE user_id = ${auth.userId} AND read = false
      `;

      return res.status(200).json({ notifications: rows, unreadCount: count });
    } catch (e: any) {
      console.error("[notifications GET]", e);
      return res.status(200).json({ notifications: [], unreadCount: 0 });
    }
  }

  /* ── PATCH: mark read ─────────────────────────────────── */
  if (req.method === "PATCH") {
    const { ids, all } = req.body || {};

    if (all) {
      await sql`
        UPDATE notifications SET read = true
        WHERE user_id = ${auth.userId} AND read = false
      `;
    } else if (Array.isArray(ids) && ids.length > 0) {
      await sql`
        UPDATE notifications SET read = true
        WHERE user_id = ${auth.userId} AND id = ANY(${ids}::uuid[])
      `;
    } else {
      return res.status(400).json({ error: "Provide ids[] or all:true" });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

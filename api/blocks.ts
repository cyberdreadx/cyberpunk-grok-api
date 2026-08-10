/**
 * /api/blocks — user-to-user blocking.
 *
 *   GET    /api/blocks              → who I've blocked
 *   POST   /api/blocks { userId }   → block
 *   DELETE /api/blocks?userId=X     → unblock
 *
 * A block is one-directional in storage but enforced in BOTH directions by
 * api/dm.ts: if either party has blocked the other, neither can send. That's
 * deliberate — a blocked user must not be able to keep talking at someone by
 * blocking them back.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();
  const me = auth.userId;

  try {
    if (req.method === "GET") {
      const rows = await sql`
        SELECT b.blocked_id, b.created_at, p.username, p.avatar_url
        FROM user_blocks b
        LEFT JOIN profiles p ON p.user_id = b.blocked_id
        WHERE b.blocker_id = ${me}::uuid
        ORDER BY b.created_at DESC
        LIMIT 500
      `;
      return res.status(200).json({
        blocks: (rows as any[]).map((r) => ({
          userId: r.blocked_id,
          username: r.username || "user",
          avatarUrl: r.avatar_url,
          createdAt: r.created_at,
        })),
      });
    }

    if (req.method === "POST") {
      const userId = String((req.body || {}).userId || "").trim();
      if (!userId) return res.status(400).json({ error: "userId required" });
      if (userId === me) return res.status(400).json({ error: "Cannot block yourself" });

      const [target] = await sql`SELECT id FROM users WHERE id = ${userId}::uuid`;
      if (!target) return res.status(404).json({ error: "User not found" });

      await sql`
        INSERT INTO user_blocks (blocker_id, blocked_id)
        VALUES (${me}::uuid, ${userId}::uuid)
        ON CONFLICT (blocker_id, blocked_id) DO NOTHING
      `;
      // Blocking implies you don't want to see them follow you either.
      await sql`
        DELETE FROM follows
        WHERE (follower_id = ${userId}::uuid AND following_id = ${me}::uuid)
           OR (follower_id = ${me}::uuid AND following_id = ${userId}::uuid)
      `;
      return res.status(200).json({ ok: true, blocked: true });
    }

    if (req.method === "DELETE") {
      const userId = String(req.query.userId || "").trim();
      if (!userId) return res.status(400).json({ error: "userId required" });
      await sql`
        DELETE FROM user_blocks
        WHERE blocker_id = ${me}::uuid AND blocked_id = ${userId}::uuid
      `;
      return res.status(200).json({ ok: true, blocked: false });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    console.error("[blocks]", e?.message || e);
    return res.status(500).json({ error: "Block action failed" });
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();

  // GET — list comments for a post
  if (req.method === "GET") {
    const { postId } = req.query;
    if (!postId) return res.status(400).json({ error: "postId required" });
    try {
      const rows = await sql`
        SELECT c.id, c.post_id, c.user_id, c.parent_id, c.text, c.created_at,
               pr.username, pr.avatar_url
        FROM comments c
        JOIN profiles pr ON pr.user_id = c.user_id
        WHERE c.post_id = ${postId}
        ORDER BY c.created_at ASC
      `;
      return res.json(rows.map((r: any) => ({
        id: r.id,
        postId: r.post_id,
        userId: r.user_id,
        parentId: r.parent_id,
        text: r.text,
        createdAt: r.created_at,
        username: r.username,
        avatarUrl: r.avatar_url,
      })));
    } catch (err: any) {
      console.error("[comments GET]", err.message);
      return res.status(500).json({ error: "Failed to fetch comments" });
    }
  }

  // POST — add comment
  if (req.method === "POST") {
    const { postId, text, parentId } = req.body || {};
    if (!postId || !text) return res.status(400).json({ error: "postId and text required" });
    if (text.length > 1000) return res.status(400).json({ error: "Comment too long (max 1000)" });
    try {
      const rows = await sql`
        INSERT INTO comments (post_id, user_id, parent_id, text)
        VALUES (${postId}, ${auth.userId}, ${parentId || null}, ${text})
        RETURNING id, created_at
      `;
      return res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
    } catch (err: any) {
      console.error("[comments POST]", err.message);
      return res.status(500).json({ error: "Failed to add comment" });
    }
  }

  // DELETE — delete own comment
  if (req.method === "DELETE") {
    const { commentId } = req.body || {};
    if (!commentId) return res.status(400).json({ error: "commentId required" });
    try {
      await sql`DELETE FROM comments WHERE id = ${commentId} AND user_id = ${auth.userId}`;
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[comments DELETE]", err.message);
      return res.status(500).json({ error: "Failed to delete comment" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

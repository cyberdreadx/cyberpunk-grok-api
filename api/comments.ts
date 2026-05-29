import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { notify } from "./_lib/notify";
import { awardKarma, revertKarma } from "./_lib/karma";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();

  if (req.method === "GET") {
    const { postId } = req.query;
    if (!postId) return res.status(400).json({ error: "postId required" });
    try {
      const rows = await sql`
        SELECT c.id, c.post_id, c.user_id, c.parent_id, c.text, c.created_at,
               pr.username, pr.avatar_url
        FROM feed_comments c
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

  if (req.method === "POST") {
    const { postId, text, parentId } = req.body || {};
    if (!postId || !text) return res.status(400).json({ error: "postId and text required" });
    if (text.length > 1000) return res.status(400).json({ error: "Comment too long (max 1000)" });
    try {
      const rows = await sql`
        INSERT INTO feed_comments (post_id, user_id, parent_id, text)
        VALUES (${postId}, ${auth.userId}, ${parentId || null}, ${text})
        RETURNING id, created_at
      `;
      const commentId = rows[0].id;

      // Karma — actor: +1 (capped/day), post owner: +2 per comment
      await awardKarma(sql, auth.userId, "comment_post", `comment_post:${commentId}`);

      const [profile] = await sql`SELECT username, avatar_url FROM profiles WHERE user_id = ${auth.userId}`;
      const [postOwner] = await sql`SELECT user_id FROM feed_posts WHERE id = ${postId}`;
      if (postOwner && postOwner.user_id !== auth.userId) {
        await awardKarma(sql, postOwner.user_id, "comment_received", `comment_received:${commentId}`);
        await notify({
          userId: postOwner.user_id,
          type: "comment",
          title: `${profile?.username || "Someone"} commented on your post`,
          body: text.slice(0, 100),
          actorId: auth.userId,
          actorUsername: profile?.username,
          actorAvatarUrl: profile?.avatar_url,
          refId: postId,
        });
      }

      return res.status(201).json({ id: commentId, createdAt: rows[0].created_at });
    } catch (err: any) {
      console.error("[comments POST]", err.message);
      return res.status(500).json({ error: "Failed to add comment" });
    }
  }

  if (req.method === "DELETE") {
    const { commentId } = req.body || {};
    if (!commentId) return res.status(400).json({ error: "commentId required" });
    try {
      await sql`DELETE FROM feed_comments WHERE id = ${commentId} AND user_id = ${auth.userId}`;
      await revertKarma(sql, `comment_post:${commentId}`);
      await revertKarma(sql, `comment_received:${commentId}`);
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[comments DELETE]", err.message);
      return res.status(500).json({ error: "Failed to delete comment" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

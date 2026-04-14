import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";

const VOTE_COLS = (userId: string) => `
  COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
  - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
  (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = '${userId}' LIMIT 1) AS user_vote
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // GET — list feed posts
  if (req.method === "GET") {
    try {
      const { filter, cursor, userId } = req.query;
      const limit = 20;

      let rows;
      if (userId) {
        rows = cursor
          ? await sql`
              SELECT p.*, pr.username, pr.avatar_url,
                COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
                - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
                (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${auth.userId} LIMIT 1) AS user_vote,
                (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id = ${userId} AND p.created_at < ${cursor}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `
          : await sql`
              SELECT p.*, pr.username, pr.avatar_url,
                COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
                - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
                (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${auth.userId} LIMIT 1) AS user_vote,
                (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id = ${userId}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `;
      } else if (filter === "following") {
        rows = cursor
          ? await sql`
              SELECT p.*, pr.username, pr.avatar_url,
                COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
                - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
                (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${auth.userId} LIMIT 1) AS user_vote,
                (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ${auth.userId})
                AND p.created_at < ${cursor}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `
          : await sql`
              SELECT p.*, pr.username, pr.avatar_url,
                COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
                - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
                (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${auth.userId} LIMIT 1) AS user_vote,
                (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ${auth.userId})
              ORDER BY p.created_at DESC LIMIT ${limit}
            `;
      } else {
        rows = cursor
          ? await sql`
              SELECT p.*, pr.username, pr.avatar_url,
                COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
                - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
                (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${auth.userId} LIMIT 1) AS user_vote,
                (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.created_at < ${cursor}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `
          : await sql`
              SELECT p.*, pr.username, pr.avatar_url,
                COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
                - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
                (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${auth.userId} LIMIT 1) AS user_vote,
                (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              ORDER BY p.created_at DESC LIMIT ${limit}
            `;
      }

      return res.json({
        posts: rows.map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          avatarUrl: r.avatar_url,
          text: r.text,
          imageUrl: r.image_url,
          createdAt: r.created_at,
          score: r.score,
          userVote: r.user_vote || null,
          commentCount: r.comment_count,
        })),
        nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
      });
    } catch (err: any) {
      console.error("[feed GET]", err.message);
      return res.status(500).json({ error: "Failed to fetch feed" });
    }
  }

  // POST — create a post
  if (req.method === "POST") {
    try {
      const { text, imageUrl } = req.body || {};
      if (!text && !imageUrl) return res.status(400).json({ error: "Post must have text or image" });
      if (text && text.length > 2000) return res.status(400).json({ error: "Text too long (max 2000)" });

      const rows = await sql`
        INSERT INTO feed_posts (user_id, text, image_url) VALUES (${auth.userId}, ${text || ""}, ${imageUrl || null})
        RETURNING id, created_at
      `;
      return res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
    } catch (err: any) {
      console.error("[feed POST]", err.message);
      return res.status(500).json({ error: "Failed to create post" });
    }
  }

  // DELETE — delete own post (or any post if admin)
  if (req.method === "DELETE") {
    try {
      const { postId } = req.body || {};
      if (!postId) return res.status(400).json({ error: "postId required" });

      const isAdmin = auth.email === (process.env.ADMIN_EMAIL || "cyberdreadx@proton.me");
      const modRows = await sql`SELECT 1 FROM feed_moderators WHERE user_id = ${auth.userId} LIMIT 1`;
      const isMod = modRows.length > 0;
      if (isAdmin || isMod) {
        await sql`DELETE FROM feed_posts WHERE id = ${postId}`;
      } else {
        await sql`DELETE FROM feed_posts WHERE id = ${postId} AND user_id = ${auth.userId}`;
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[feed DELETE]", err.message);
      return res.status(500).json({ error: "Failed to delete post" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

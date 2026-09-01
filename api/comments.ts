import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, checkBan } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { notify } from "./_lib/notify";
import { awardKarma, revertKarma } from "./_lib/karma";
import { checkRateLimit } from "./_lib/ratelimit";

/*
 * Comment anti-spam.
 *
 * This endpoint had no rate limit, no ban check and no duplicate guard, so a
 * script could hold a post open indefinitely — and 107 comments had already
 * been written by accounts that were banned at the time.
 *
 * The numbers come from the real distribution rather than from taste: across
 * 1,309 comments, one user on one post is a median of 1, p95 of 2, p99 of 5.
 * The only accounts above that were posting "ád" and single words. These
 * limits sit well above genuine conversation and well below flooding.
 */
const MAX_PER_MINUTE = 10;
const MAX_PER_HOUR = 60;
/** Burst on a single post — p99 across all history is 5. */
const MAX_PER_POST = 5;
const PER_POST_WINDOW_MIN = 10;
/** Repeating yourself verbatim on the same post is not a conversation. */
const DUPLICATE_WINDOW_HOURS = 24;
/** One notification per actor per post per window, however much they type. */
const NOTIFY_COOLDOWN_MIN = 10;
const MIN_LENGTH = 2;

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
    const { postId, text: rawText, parentId } = req.body || {};
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (!postId || !text) return res.status(400).json({ error: "postId and text required" });
    // The old check was `!text`, which a string of spaces passes.
    if (text.length < MIN_LENGTH) return res.status(400).json({ error: "That comment is too short." });
    if (text.length > 1000) return res.status(400).json({ error: "Comment too long (max 1000)" });

    const { banned } = await checkBan(sql as any, auth.userId);
    if (banned) return res.status(403).json({ error: "This account cannot comment." });

    const minute = await checkRateLimit(`comment:${auth.userId}`, "comment-min",
      { max: MAX_PER_MINUTE, windowSeconds: 60 });
    if (!minute.allowed) {
      return res.status(429).json({ error: "You're commenting too fast. Wait a moment." });
    }
    const hour = await checkRateLimit(`comment:${auth.userId}`, "comment-hour",
      { max: MAX_PER_HOUR, windowSeconds: 3600 });
    if (!hour.allowed) {
      return res.status(429).json({ error: "You've hit the hourly comment limit." });
    }

    try {
      // Burst and duplicate are per (user, post), so they need the table
      // rather than the shared counter.
      const [guard] = await sql`
        SELECT
          count(*) FILTER (
            WHERE created_at > now() - (${PER_POST_WINDOW_MIN} || ' minutes')::interval
          )::int AS recent,
          count(*) FILTER (
            WHERE lower(btrim(text)) = lower(${text})
              AND created_at > now() - (${DUPLICATE_WINDOW_HOURS} || ' hours')::interval
          )::int AS same
        FROM feed_comments
        WHERE post_id = ${postId} AND user_id = ${auth.userId}
      ` as any[];

      if (Number(guard?.same) > 0) {
        return res.status(409).json({ error: "You already posted that comment." });
      }
      if (Number(guard?.recent) >= MAX_PER_POST) {
        return res.status(429).json({ error: "That's a lot of comments on one post. Give it a minute." });
      }

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

        // One notification per actor per post per cooldown. Without this a
        // run of allowed comments still lands as a run of pings, which is the
        // part the post owner actually experiences as spam.
        const [prior] = await sql`
          SELECT count(*)::int AS n FROM feed_comments
          WHERE post_id = ${postId} AND user_id = ${auth.userId}
            AND id <> ${commentId}
            AND created_at > now() - (${NOTIFY_COOLDOWN_MIN} || ' minutes')::interval
        ` as any[];
        if (Number(prior?.n) === 0) await notify({
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

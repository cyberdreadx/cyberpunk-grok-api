import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { notify } from "./_lib/notify";
import { awardKarma, revertKarma } from "./_lib/karma";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "POST") {
    const sql = getDb();
    const { postId, emoji } = req.body || {};
    if (!postId) return res.status(400).json({ error: "postId required" });

    const vote = emoji === "👎" ? "👎" : "👍";

    try {
      const existing = await sql`
        SELECT id, emoji FROM feed_reactions WHERE post_id = ${postId} AND user_id = ${auth.userId}
      `;
      const [postOwnerRow] = await sql`SELECT user_id FROM feed_posts WHERE id = ${postId}`;
      const postOwnerId: string | undefined = postOwnerRow?.user_id;

      if (existing.length > 0) {
        const prevVote = existing[0].emoji;
        if (prevVote === vote) {
          await sql`DELETE FROM feed_reactions WHERE id = ${existing[0].id}`;
          await revertKarma(sql, `like_given:${existing[0].id}`);
          if (prevVote === "👍" && postOwnerId) {
            await revertKarma(sql, `upvote_received:${existing[0].id}`);
          }
          return res.json({ action: "removed", vote: null });
        } else {
          await sql`UPDATE feed_reactions SET emoji = ${vote} WHERE id = ${existing[0].id}`;
          if (prevVote === "👍" && postOwnerId) {
            await revertKarma(sql, `upvote_received:${existing[0].id}`);
          }
          if (vote === "👍" && postOwnerId && postOwnerId !== auth.userId) {
            await awardKarma(sql, postOwnerId, "upvote_received", `upvote_received:${existing[0].id}`);
          }
          return res.json({ action: "switched", vote });
        }
      } else {
        const inserted = await sql`
          INSERT INTO feed_reactions (post_id, user_id, emoji)
          VALUES (${postId}, ${auth.userId}, ${vote})
          RETURNING id
        `;
        const reactionId = inserted[0].id;

        // Karma — actor (capped/day) + post owner on upvotes
        await awardKarma(sql, auth.userId, "like_given", `like_given:${reactionId}`);

        if (vote === "👍" && postOwnerId && postOwnerId !== auth.userId) {
          await awardKarma(sql, postOwnerId, "upvote_received", `upvote_received:${reactionId}`);
          const [profile] = await sql`SELECT username, avatar_url FROM profiles WHERE user_id = ${auth.userId}`;
          await notify({
            userId: postOwnerId,
            type: "upvote",
            title: `${profile?.username || "Someone"} upvoted your post`,
            actorId: auth.userId,
            actorUsername: profile?.username,
            actorAvatarUrl: profile?.avatar_url,
            refId: postId,
          });
        }

        return res.json({ action: "added", vote });
      }
    } catch (err: any) {
      console.error("[reactions]", err.message);
      return res.status(500).json({ error: "Failed to toggle reaction" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { notify } from "./_lib/notify";

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

    // Normalize: only allow 👍 (upvote) or 👎 (downvote)
    const vote = emoji === "👎" ? "👎" : "👍";

    try {
      // Check existing vote
      const existing = await sql`
        SELECT id, emoji FROM feed_reactions WHERE post_id = ${postId} AND user_id = ${auth.userId}
      `;

      if (existing.length > 0) {
        if (existing[0].emoji === vote) {
          // Same vote — toggle off
          await sql`DELETE FROM feed_reactions WHERE id = ${existing[0].id}`;
          return res.json({ action: "removed", vote: null });
        } else {
          // Different vote — switch
          await sql`UPDATE feed_reactions SET emoji = ${vote} WHERE id = ${existing[0].id}`;
          return res.json({ action: "switched", vote });
        }
      } else {
        await sql`INSERT INTO feed_reactions (post_id, user_id, emoji) VALUES (${postId}, ${auth.userId}, ${vote})`;
        
        // Notify post owner on upvote only
        if (vote === "👍") {
          const [postOwner] = await sql`SELECT user_id FROM feed_posts WHERE id = ${postId}`;
          const [profile] = await sql`SELECT username, avatar_url FROM profiles WHERE user_id = ${auth.userId}`;
          if (postOwner && postOwner.user_id !== auth.userId) {
            notify({
              userId: postOwner.user_id,
              type: "upvote",
              title: `${profile?.username || "Someone"} upvoted your post`,
              actorId: auth.userId,
              actorUsername: profile?.username,
              actorAvatarUrl: profile?.avatar_url,
              refId: postId,
            });
          }
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

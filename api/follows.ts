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
    const { targetUserId } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: "targetUserId required" });
    if (targetUserId === auth.userId) return res.status(400).json({ error: "Cannot follow yourself" });

    try {
      const existing = await sql`
        SELECT 1 FROM follows WHERE follower_id = ${auth.userId} AND following_id = ${targetUserId}
      `;
      if (existing.length > 0) {
        await sql`DELETE FROM follows WHERE follower_id = ${auth.userId} AND following_id = ${targetUserId}`;
        return res.json({ action: "unfollowed" });
      } else {
        await sql`INSERT INTO follows (follower_id, following_id) VALUES (${auth.userId}, ${targetUserId})`;
        
        // Notify the followed user
        const [profile] = await sql`SELECT username, avatar_url FROM profiles WHERE user_id = ${auth.userId}`;
        notify({
          userId: targetUserId,
          type: "follow",
          title: `${profile?.username || "Someone"} started following you`,
          actorId: auth.userId,
          actorUsername: profile?.username,
          actorAvatarUrl: profile?.avatar_url,
        });

        return res.json({ action: "followed" });
      }
    } catch (err: any) {
      console.error("[follows]", err.message);
      return res.status(500).json({ error: "Failed to toggle follow" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

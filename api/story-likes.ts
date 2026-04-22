import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { awardKarma, revertKarma } from "./_lib/karma";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "POST") {
    try {
      const { storyId } = req.body || {};
      if (!storyId) return res.status(400).json({ error: "storyId required" });

      const [story] = await sql`SELECT user_id FROM stories WHERE id = ${storyId}::uuid`;
      const ownerId: string | undefined = story?.user_id;

      const [existing] = await sql`
        SELECT id FROM story_likes WHERE story_id = ${storyId}::uuid AND user_id = ${auth.userId}::uuid
      `;

      if (existing) {
        await sql`DELETE FROM story_likes WHERE id = ${existing.id}::uuid`;
        await revertKarma(sql, `like_given:story:${existing.id}`);
        if (ownerId) await revertKarma(sql, `story_like_received:${existing.id}`);
        return res.status(200).json({ liked: false });
      } else {
        const inserted = await sql`
          INSERT INTO story_likes (story_id, user_id)
          VALUES (${storyId}::uuid, ${auth.userId}::uuid)
          ON CONFLICT (story_id, user_id) DO NOTHING
          RETURNING id
        `;
        const likeId = inserted[0]?.id;
        if (likeId) {
          await awardKarma(sql, auth.userId, "like_given", `like_given:story:${likeId}`);
          if (ownerId && ownerId !== auth.userId) {
            await awardKarma(sql, ownerId, "story_like_received", `story_like_received:${likeId}`);
          }
        }
        return res.status(200).json({ liked: true });
      }
    } catch (err: any) {
      console.error("[story-likes] POST error:", err.message);
      return res.status(500).json({ error: "Failed to toggle like" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

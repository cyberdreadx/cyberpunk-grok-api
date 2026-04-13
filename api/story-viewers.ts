import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sql = getDb();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const storyId = req.query.storyId as string;
  if (!storyId) return res.status(400).json({ error: "storyId required" });

  try {
    // Verify the story belongs to the requesting user
    const [story] = await sql`SELECT user_id FROM stories WHERE id = ${storyId}::uuid`;
    if (!story || story.user_id !== auth.userId) {
      return res.status(403).json({ error: "Can only view viewers of your own stories" });
    }

    const viewers = await sql`
      SELECT sv.viewer_id, sv.viewed_at, u.email,
        (SELECT username FROM profiles WHERE user_id = sv.viewer_id LIMIT 1) AS username,
        (SELECT avatar_url FROM profiles WHERE user_id = sv.viewer_id LIMIT 1) AS avatar_url
      FROM story_views sv
      JOIN users u ON u.id = sv.viewer_id
      WHERE sv.story_id = ${storyId}::uuid
      ORDER BY sv.viewed_at DESC
    `;

    return res.status(200).json({
      viewers: viewers.map((v: any) => ({
        userId: v.viewer_id,
        username: v.username || (v.email || "").split("@")[0] || "user",
        avatarUrl: v.avatar_url || null,
        viewedAt: v.viewed_at,
      })),
    });
  } catch (err: any) {
    console.error("[story-viewers] GET error:", err.message);
    return res.status(500).json({ error: "Failed to fetch viewers" });
  }
}

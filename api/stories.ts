import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { getDb } from "./_lib/db";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();

  // POST — create a story
  if (req.method === "POST") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const { mediaUrl, mediaType, caption, prompt } = req.body || {};
      if (!mediaUrl) return res.status(400).json({ error: "mediaUrl required" });

      const type = (mediaType || "image").startsWith("video") ? "video" : "image";

      const rows = await sql`
        INSERT INTO stories (user_id, media_url, media_type, caption, prompt)
        VALUES (${auth.userId}::uuid, ${mediaUrl}, ${type}, ${caption || ""}, ${prompt || ""})
        RETURNING id, created_at, expires_at
      `;

      return res.status(200).json({ id: rows[0].id, created_at: rows[0].created_at, expires_at: rows[0].expires_at });
    } catch (err: any) {
      console.error("[stories] POST error:", err.message);
      return res.status(500).json({ error: "Failed to create story" });
    }
  }

  // GET — fetch active stories (grouped by user)
  if (req.method === "GET") {
    try {
      const auth = getUserFromRequest(req);
      const viewerId = auth?.userId || null;

      const rows = await sql`
        SELECT
          s.id, s.user_id, s.media_url, s.media_type, s.caption, s.prompt,
          s.created_at, s.expires_at,
          u.email,
          CASE WHEN sv.viewer_id IS NOT NULL THEN true ELSE false END AS viewed,
          (SELECT COUNT(*)::int FROM story_views sv2 WHERE sv2.story_id = s.id) AS view_count
        FROM stories s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = ${viewerId}::uuid
        WHERE s.expires_at > now()
        ORDER BY s.created_at DESC
      `;

      // Group by user
      const grouped: Record<string, any> = {};
      for (const r of rows) {
        if (!grouped[r.user_id]) {
          // Extract display name from email
          const name = (r.email || "").split("@")[0] || "user";
          grouped[r.user_id] = {
            userId: r.user_id,
            username: name,
            stories: [],
            hasUnviewed: false,
          };
        }
        grouped[r.user_id].stories.push({
          id: r.id,
          mediaUrl: r.media_url,
          mediaType: r.media_type,
          caption: r.caption,
          prompt: r.prompt,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          viewed: r.viewed,
          viewCount: r.view_count || 0,
        });
        if (!r.viewed) grouped[r.user_id].hasUnviewed = true;
      }

      return res.status(200).json({ users: Object.values(grouped) });
    } catch (err: any) {
      console.error("[stories] GET error:", err.message);
      return res.status(500).json({ error: "Failed to fetch stories" });
    }
  }

  // PUT — mark story as viewed
  if (req.method === "PUT") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const { storyId } = req.body || {};
      if (!storyId) return res.status(400).json({ error: "storyId required" });

      await sql`
        INSERT INTO story_views (story_id, viewer_id)
        VALUES (${storyId}::uuid, ${auth.userId}::uuid)
        ON CONFLICT (story_id, viewer_id) DO NOTHING
      `;

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error("[stories] PUT error:", err.message);
      return res.status(500).json({ error: "Failed to mark viewed" });
    }
  }

  // DELETE — delete a story (owner or admin)
  if (req.method === "DELETE") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const storyId = (req.query.id || req.body?.storyId) as string;
      if (!storyId) return res.status(400).json({ error: "storyId required" });

      const isAdmin = auth.email === ADMIN_EMAIL;

      const rows = await sql`
        SELECT user_id FROM stories WHERE id = ${storyId}::uuid
      `;
      if (rows.length === 0) return res.status(404).json({ error: "Story not found" });

      const isOwner = rows[0].user_id === auth.userId;
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: "Not allowed to delete this story" });
      }

      await sql`DELETE FROM stories WHERE id = ${storyId}::uuid`;

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error("[stories] DELETE error:", err.message);
      return res.status(500).json({ error: "Failed to delete story" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

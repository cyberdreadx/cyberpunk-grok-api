import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";

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
    const e = (emoji || "❤️").slice(0, 4);

    try {
      // Toggle: delete if exists, insert if not
      const existing = await sql`
        SELECT id FROM reactions WHERE post_id = ${postId} AND user_id = ${auth.userId} AND emoji = ${e}
      `;
      if (existing.length > 0) {
        await sql`DELETE FROM reactions WHERE id = ${existing[0].id}`;
        return res.json({ action: "removed" });
      } else {
        await sql`INSERT INTO reactions (post_id, user_id, emoji) VALUES (${postId}, ${auth.userId}, ${e})`;
        return res.json({ action: "added" });
      }
    } catch (err: any) {
      console.error("[reactions]", err.message);
      return res.status(500).json({ error: "Failed to toggle reaction" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

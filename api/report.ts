import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";

const FLAG_THRESHOLD = 6;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sql = getDb();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { postId, reason } = req.body || {};
  if (!postId) return res.status(400).json({ error: "postId required" });

  try {
    // Can't report own post
    const postRows = await sql`SELECT user_id FROM feed_posts WHERE id = ${postId}`;
    if (postRows.length === 0) return res.status(404).json({ error: "Post not found" });
    if (postRows[0].user_id === auth.userId) return res.status(400).json({ error: "Cannot report your own post" });

    // Insert report (ignore duplicate)
    await sql`
      INSERT INTO feed_reports (post_id, user_id, reason)
      VALUES (${postId}, ${auth.userId}, ${reason || ''})
      ON CONFLICT (post_id, user_id) DO NOTHING
    `;

    // Check total unique reporters
    const countRows = await sql`SELECT count(*)::int AS cnt FROM feed_reports WHERE post_id = ${postId}`;
    const flagCount = countRows[0].cnt;

    // Auto-takedown
    if (flagCount >= FLAG_THRESHOLD) {
      await sql`DELETE FROM feed_posts WHERE id = ${postId}`;
      return res.json({ success: true, flagCount, removed: true });
    }

    return res.json({ success: true, flagCount, removed: false });
  } catch (err: any) {
    console.error("[report]", err.message);
    return res.status(500).json({ error: "Failed to report post" });
  }
}

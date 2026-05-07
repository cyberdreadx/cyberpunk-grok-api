/**
 * /api/featured-creators — public list of approved/featured creators for /creators directory.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { applyCors } from "./_lib/cors";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const sql = getDb();
  try {
    const rows = await sql`
      SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio,
             u.verification_status, u.featured_at
      FROM users u
      WHERE u.is_featured_creator = true
      ORDER BY u.featured_at DESC NULLS LAST
      LIMIT 100
    `;
    return res.status(200).json({ creators: rows });
  } catch (e) {
    // Tolerate missing columns (older schema) — return empty list
    console.warn("[featured-creators] failed:", (e as Error).message);
    return res.status(200).json({ creators: [] });
  }
}

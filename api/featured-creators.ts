/**
 * /api/featured-creators — public list of approved/featured creators for /creators directory.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { applyCors } from "./_lib/cors";
import { ADMIN_EMAIL } from "./_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const sql = getDb();
  try {
    const rows = await sql`
      SELECT u.id,
             p.username,
             p.username AS display_name,
             p.avatar_url,
             p.bio,
             u.verification_status,
             u.featured_at,
             CASE
               WHEN u.creator_persona_chat_enabled AND pc.id IS NOT NULL THEN pc.id
               ELSE NULL
             END AS persona_chat_character_id,
             pc.name AS persona_chat_character_name
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      LEFT JOIN characters pc ON pc.id = u.official_character_id
        AND u.creator_persona_chat_enabled = true
        AND pc.is_public = true
      WHERE u.verification_status = 'verified'
        AND p.username IS NOT NULL
        AND u.email <> ${ADMIN_EMAIL}
        AND (u.verification_renews_at IS NULL OR u.verification_renews_at > now())
        AND (u.is_featured_creator = true OR p.avatar_url IS NOT NULL)
      ORDER BY u.is_featured_creator DESC,
               (p.avatar_url IS NOT NULL) DESC,
               (CASE WHEN u.creator_persona_chat_enabled THEN 1 ELSE 0 END) DESC,
               u.featured_at DESC NULLS LAST,
               u.created_at DESC
      LIMIT 100
    `;
    return res.status(200).json({ creators: rows });
  } catch (e) {
    // Tolerate missing columns (older schema) — return empty list
    console.warn("[featured-creators] failed:", (e as Error).message);
    return res.status(200).json({ creators: [] });
  }
}

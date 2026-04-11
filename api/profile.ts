import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // GET — fetch profile (own or by username)
  if (req.method === "GET") {
    try {
      const { username } = req.query;
      let rows;
      if (username) {
        rows = await sql`
          SELECT p.user_id, p.username, p.avatar_url, p.bio, p.created_at,
                 u.email,
                 (SELECT count(*)::int FROM follows WHERE following_id = p.user_id) AS followers,
                 (SELECT count(*)::int FROM follows WHERE follower_id = p.user_id) AS following,
                 (SELECT count(*)::int FROM feed_posts WHERE user_id = p.user_id) AS post_count
          FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.username = ${username}
        `;
      } else {
        rows = await sql`
          SELECT p.user_id, p.username, p.avatar_url, p.bio, p.created_at,
                 u.email,
                 (SELECT count(*)::int FROM follows WHERE following_id = p.user_id) AS followers,
                 (SELECT count(*)::int FROM follows WHERE follower_id = p.user_id) AS following,
                 (SELECT count(*)::int FROM feed_posts WHERE user_id = p.user_id) AS post_count
          FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.user_id = ${auth.userId}
        `;
      }
      if (rows.length === 0) return res.status(404).json({ error: "Profile not found" });

      const p = rows[0];
      // Check if viewer follows this user
      let isFollowing = false;
      if (username && p.user_id !== auth.userId) {
        const f = await sql`SELECT 1 FROM follows WHERE follower_id = ${auth.userId} AND following_id = ${p.user_id}`;
        isFollowing = f.length > 0;
      }

      return res.json({
        userId: p.user_id,
        username: p.username,
        avatarUrl: p.avatar_url,
        bio: p.bio,
        createdAt: p.created_at,
        followers: p.followers,
        following: p.following,
        postCount: p.post_count,
        isOwn: p.user_id === auth.userId,
        isFollowing,
      });
    } catch (err: any) {
      console.error("[profile GET]", err.message);
      return res.status(500).json({ error: "Failed to fetch profile" });
    }
  }

  // PUT — update own profile
  if (req.method === "PUT") {
    try {
      const { username, bio, avatarUrl } = req.body || {};

      // Validate username
      if (username !== undefined) {
        const clean = (username || "").trim().toLowerCase();
        if (clean.length < 3 || clean.length > 24) {
          return res.status(400).json({ error: "Username must be 3–24 characters" });
        }
        if (!/^[a-z0-9_]+$/.test(clean)) {
          return res.status(400).json({ error: "Username: letters, numbers, underscores only" });
        }
        // Check uniqueness
        const existing = await sql`SELECT user_id FROM profiles WHERE username = ${clean} AND user_id != ${auth.userId}`;
        if (existing.length > 0) {
          return res.status(409).json({ error: "Username already taken" });
        }
      }

      if (bio !== undefined && bio.length > 300) {
        return res.status(400).json({ error: "Bio must be under 300 characters" });
      }

      // Upsert profile
      const cleanUsername = username ? username.trim().toLowerCase() : undefined;
      await sql`
        INSERT INTO profiles (user_id, username, bio, avatar_url, updated_at)
        VALUES (
          ${auth.userId},
          COALESCE(${cleanUsername ?? null}, 'user_' || substr(${auth.userId}::text, 1, 8)),
          COALESCE(${bio ?? null}, ''),
          ${avatarUrl ?? null},
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          username = COALESCE(${cleanUsername ?? null}, profiles.username),
          bio = COALESCE(${bio ?? null}, profiles.bio),
          avatar_url = COALESCE(${avatarUrl ?? null}, profiles.avatar_url),
          updated_at = NOW()
      `;

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[profile PUT]", err.message);
      return res.status(500).json({ error: "Failed to update profile" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

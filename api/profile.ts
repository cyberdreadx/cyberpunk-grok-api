import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
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
                 u.email, p.wallet_address,
                 u.verification_status, u.verification_renews_at,
                 u.holder_tier, u.holder_tier_since, u.last_snapshot_total,
                 (SELECT count(*)::int FROM follows WHERE following_id = p.user_id) AS followers,
                 (SELECT count(*)::int FROM follows WHERE follower_id = p.user_id) AS following,
                 (SELECT count(*)::int FROM feed_posts WHERE user_id = p.user_id) AS post_count
          FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.username = ${username}
        `;
      } else {
        rows = await sql`
          SELECT p.user_id, p.username, p.avatar_url, p.bio, p.created_at,
                 u.email, p.wallet_address,
                 u.verification_status, u.verification_renews_at,
                 u.holder_tier, u.holder_tier_since, u.last_snapshot_total,
                 (SELECT count(*)::int FROM follows WHERE following_id = p.user_id) AS followers,
                 (SELECT count(*)::int FROM follows WHERE follower_id = p.user_id) AS following,
                 (SELECT count(*)::int FROM feed_posts WHERE user_id = p.user_id) AS post_count
          FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.user_id = ${auth.userId}
        `;
      }
      // Auto-create profile for authenticated user if missing
      if (rows.length === 0 && !username) {
        await sql`
          INSERT INTO profiles (user_id, username)
          VALUES (${auth.userId}, 'user_' || substr(${auth.userId}::text, 1, 8))
          ON CONFLICT DO NOTHING
        `;
        // Re-fetch
        rows = await sql`
          SELECT p.user_id, p.username, p.avatar_url, p.bio, p.created_at,
                 u.email, p.wallet_address,
                 u.verification_status, u.verification_renews_at,
                 u.holder_tier, u.holder_tier_since, u.last_snapshot_total,
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

      // Check ban status (visible to admins only)
      let isBanned = false;
      let banReason: string | null = null;
      if (auth.email === ADMIN_EMAIL && p.user_id !== auth.userId) {
        const banRows = await sql`SELECT reason FROM user_bans WHERE user_id = ${p.user_id}::uuid LIMIT 1`.catch(() => []);
        if (banRows.length > 0) {
          isBanned = true;
          banReason = banRows[0].reason;
        }
      }

      const isVerifiedActive =
        p.email === ADMIN_EMAIL ||
        (p.verification_status === "verified" &&
          (!p.verification_renews_at || new Date(p.verification_renews_at) > new Date()));

      // Holder tier — public on every profile (social proof of long-term holders)
      const holderTier = p.holder_tier || "none";
      let holderStreakDays = 0;
      if (p.holder_tier_since && holderTier !== "none") {
        const since = new Date(p.holder_tier_since).getTime();
        if (!Number.isNaN(since)) {
          holderStreakDays = Math.max(0, Math.floor((Date.now() - since) / (1000 * 60 * 60 * 24)));
        }
      }
      const holderTotalHeld = parseFloat(p.last_snapshot_total) || 0;

      return res.json({
        userId: p.user_id,
        username: p.username,
        avatarUrl: p.avatar_url,
        bio: p.bio,
        walletAddress: p.user_id === auth.userId ? (p.wallet_address || null) : null,
        walletTruncated: p.wallet_address ? `${p.wallet_address.slice(0, 6)}...${p.wallet_address.slice(-4)}` : null,
        createdAt: p.created_at,
        followers: p.followers,
        following: p.following,
        postCount: p.post_count,
        isOwn: p.user_id === auth.userId,
        isFollowing,
        isBanned,
        banReason,
        verified: isVerifiedActive,
        holderTier,
        holderStreakDays,
        // Public total only shown if tier > none
        holderTotalHeld: holderTier === "none" ? null : holderTotalHeld,
      });
    } catch (err: any) {
      console.error("[profile GET]", err.message);
      return res.status(500).json({ error: "Failed to fetch profile" });
    }
  }

  // PUT — update own profile
  if (req.method === "PUT") {
    try {
      const { username, bio, avatarUrl, walletAddress } = req.body || {};

      // Validate wallet address
      if (walletAddress !== undefined && walletAddress !== null && walletAddress !== "") {
        const clean = walletAddress.trim().toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(clean)) {
          return res.status(400).json({ error: "Invalid wallet address (must be 0x + 40 hex chars)" });
        }
      }
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
      const cleanWallet = walletAddress !== undefined ? (walletAddress ? walletAddress.trim().toLowerCase() : null) : undefined;

      // If avatar is being replaced, capture the previous URL so we can purge the old blob.
      let previousAvatar: string | null = null;
      if (avatarUrl !== undefined && avatarUrl !== null) {
        const prev = await sql`SELECT avatar_url FROM profiles WHERE user_id = ${auth.userId}`;
        previousAvatar = prev[0]?.avatar_url || null;
      }

      await sql`
        INSERT INTO profiles (user_id, username, bio, avatar_url, wallet_address, updated_at)
        VALUES (
          ${auth.userId},
          COALESCE(${cleanUsername ?? null}, 'user_' || substr(${auth.userId}::text, 1, 8)),
          COALESCE(${bio ?? null}, ''),
          ${avatarUrl ?? null},
          ${cleanWallet ?? null},
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          username = COALESCE(${cleanUsername ?? null}, profiles.username),
          bio = COALESCE(${bio ?? null}, profiles.bio),
          avatar_url = COALESCE(${avatarUrl ?? null}, profiles.avatar_url),
          wallet_address = COALESCE(${cleanWallet ?? null}, profiles.wallet_address),
          updated_at = NOW()
      `;

      // Best-effort: delete the old avatar blob if it was replaced.
      if (previousAvatar && previousAvatar !== avatarUrl) {
        const { deleteBlobs } = await import("./_lib/blob");
        await deleteBlobs([previousAvatar]);
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[profile PUT]", err.message);
      return res.status(500).json({ error: "Failed to update profile" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

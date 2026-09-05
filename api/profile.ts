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

      // Core query — only depends on always-present columns. Optional fields
      // (verification_*, holder_*) are fetched separately so a missing migration
      // on a self-hosted deploy doesn't 500 the whole endpoint.
      const fetchCore = async () => {
        if (username) {
          return await sql`
            SELECT p.user_id, p.username, p.avatar_url, p.bio, p.created_at,
                   u.email, p.wallet_address,
                   (SELECT count(*)::int FROM follows WHERE following_id = p.user_id) AS followers,
                   (SELECT count(*)::int FROM follows WHERE follower_id = p.user_id) AS following,
                   (SELECT count(*)::int FROM feed_posts WHERE user_id = p.user_id) AS post_count
            FROM profiles p JOIN users u ON u.id = p.user_id
            WHERE p.username = ${username}
          `;
        }
        return await sql`
          SELECT p.user_id, p.username, p.avatar_url, p.bio, p.created_at,
                 u.email, p.wallet_address,
                 (SELECT count(*)::int FROM follows WHERE following_id = p.user_id) AS followers,
                 (SELECT count(*)::int FROM follows WHERE follower_id = p.user_id) AS following,
                 (SELECT count(*)::int FROM feed_posts WHERE user_id = p.user_id) AS post_count
          FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.user_id = ${auth.userId}
        `;
      };

      let rows = await fetchCore();
      // Auto-create profile for authenticated user if missing
      if (rows.length === 0 && !username) {
        await sql`
          INSERT INTO profiles (user_id, username)
          VALUES (${auth.userId}, 'user_' || substr(${auth.userId}::text, 1, 8))
          ON CONFLICT DO NOTHING
        `;
        rows = await fetchCore();
      }

      // Best-effort enrichment with optional columns
      if (rows.length > 0) {
        const uid = rows[0].user_id;
        const extras = await sql`
          SELECT verification_status, verification_renews_at,
                 holder_tier, holder_tier_since, last_snapshot_total,
                 official_character_id, creator_persona_chat_enabled
          FROM users WHERE id = ${uid}
        `.catch(() => [] as any[]);
        if (extras.length > 0) Object.assign(rows[0], extras[0]);
        // Socials (optional column — best-effort so a missing migration won't 500)
        const soc = await sql`SELECT socials FROM profiles WHERE user_id = ${uid}`.catch(() => [] as any[]);
        if (soc.length > 0) rows[0].socials = soc[0].socials;
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

      const personaEnabled = !!p.creator_persona_chat_enabled;
      const officialId = p.official_character_id || null;
      const showFanChatCta = personaEnabled && !!officialId && p.user_id !== auth.userId;

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
        socials: p.socials && typeof p.socials === "object" ? p.socials : {},
        /** Fan-visible: open Characters chat with this persona */
        personaChatCharacterId: showFanChatCta ? officialId : null,
        /** Own profile: settings panel */
        creatorPersonaChatEnabled: p.user_id === auth.userId ? personaEnabled : undefined,
        // Exposed to the owner and to admins (admins can replace the persona photo).
        officialCharacterId: p.user_id === auth.userId || auth.email === ADMIN_EMAIL ? officialId : undefined,
      });
    } catch (err: any) {
      console.error("[profile GET]", err?.message, err?.stack);
      return res.status(500).json({ error: err?.message || "Failed to fetch profile" });
    }
  }

  // PUT — update own profile
  if (req.method === "PUT") {
    try {
      const { username, bio, avatarUrl, walletAddress, socials } = req.body || {};

      // Sanitize socials: only known platforms, string values, trimmed/capped.
      const SOCIAL_KEYS = ["instagram", "x", "tiktok", "onlyfans", "other"];
      let cleanSocials: Record<string, string> | undefined;
      if (socials !== undefined && socials !== null) {
        if (typeof socials !== "object") {
          return res.status(400).json({ error: "Invalid socials" });
        }
        cleanSocials = {};
        for (const k of SOCIAL_KEYS) {
          const v = (socials as any)[k];
          if (typeof v === "string" && v.trim()) cleanSocials[k] = v.trim().slice(0, 300);
        }
      }

      // Wallet address is no longer settable here. profiles.wallet_address feeds
      // the holder-tier snapshot, and this route never proved ownership or checked
      // whether another account had already claimed the address — so it was a way
      // to inherit a whale's balance by typing their public address. Binding now
      // goes through the signature challenge in /api/v1/xrge-wallet.
      //
      // Resubmitting the address already on file is allowed as a no-op, because
      // ProfilePage round-trips the whole form and would otherwise break every save.
      let unbindWallet = false;
      if (walletAddress !== undefined) {
        const submitted = walletAddress === null ? "" : String(walletAddress).trim().toLowerCase();
        const [current] = await sql`
          SELECT LOWER(wallet_address) AS wallet_address FROM profiles WHERE user_id = ${auth.userId}
        `;
        const bound = current?.wallet_address || "";
        if (submitted === "") {
          // Clearing is only ever a downgrade, so it needs no proof.
          unbindWallet = bound !== "";
        } else if (submitted !== bound) {
          return res.status(400).json({
            error:
              "Wallet binding moved — connect and sign in the $XRGE bank to prove you own this address",
            code: "wallet_requires_signature",
          });
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
      // Never carries a new address — see the wallet block above. It only ever
      // stays put (undefined) or clears (unbind).
      const cleanWallet = undefined;

      // If avatar is being replaced, capture the previous URL so we can purge the old blob.
      let previousAvatar: string | null = null;
      if (avatarUrl !== undefined && avatarUrl !== null) {
        const prev = await sql`SELECT avatar_url FROM profiles WHERE user_id = ${auth.userId}`;
        previousAvatar = prev[0]?.avatar_url || null;
      }

      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '{}'::jsonb`.catch(() => {});

      const socialsInsert = cleanSocials ? JSON.stringify(cleanSocials) : "{}";
      const socialsUpdate = cleanSocials ? JSON.stringify(cleanSocials) : null;

      await sql`
        INSERT INTO profiles (user_id, username, bio, avatar_url, wallet_address, socials, updated_at)
        VALUES (
          ${auth.userId},
          COALESCE(${cleanUsername ?? null}, 'user_' || substr(${auth.userId}::text, 1, 8)),
          COALESCE(${bio ?? null}, ''),
          ${avatarUrl ?? null},
          ${cleanWallet ?? null},
          ${socialsInsert}::jsonb,
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          username = COALESCE(${cleanUsername ?? null}, profiles.username),
          bio = COALESCE(${bio ?? null}, profiles.bio),
          avatar_url = COALESCE(${avatarUrl ?? null}, profiles.avatar_url),
          wallet_address = COALESCE(${cleanWallet ?? null}, profiles.wallet_address),
          socials = COALESCE(${socialsUpdate}::jsonb, profiles.socials),
          updated_at = NOW()
      `;

      // Clearing the field unbinds everywhere, so the holder snapshot stops
      // counting the address on the next cron pass.
      if (unbindWallet) {
        await sql`
          UPDATE profiles SET wallet_address = NULL, wallet_verified_at = NULL, updated_at = NOW()
           WHERE user_id = ${auth.userId}`;
        await sql`
          UPDATE users SET wallet_address = NULL, wallet_verified_at = NULL, updated_at = NOW()
           WHERE id = ${auth.userId}`;
      }

      // Best-effort: delete the old avatar file (Blob or R2) if it was replaced.
      if (previousAvatar && previousAvatar !== avatarUrl) {
        const { deleteMediaUrls } = await import("./_lib/media-delete");
        await deleteMediaUrls([previousAvatar]);
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[profile PUT]", err.message);
      return res.status(500).json({ error: "Failed to update profile" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

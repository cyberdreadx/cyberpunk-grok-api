import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, ADMIN_EMAIL, checkBan } from "./_lib/auth";
import { getDb } from "./_lib/db";

export const config = { maxDuration: 30 };

const MAX_LOCK_COST = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();

  // POST — create a story
  if (req.method === "POST") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      // Check if user is banned
      const ban = await checkBan(sql, auth.userId);
      if (ban.banned) {
        return res.status(403).json({ error: "Your account has been suspended.", reason: ban.reason });
      }

      // Posting gate: must have purchased credits at least once
      if (!(await hasPurchased(sql, auth.userId))) {
        return res.status(403).json({ error: POSTING_GATE_MESSAGE, code: "PURCHASE_REQUIRED" });
      }

      const { mediaUrl, mediaType, caption, prompt, lockCost, lockXrgeAmount } = req.body || {};
      if (!mediaUrl) return res.status(400).json({ error: "mediaUrl required" });

      const type = (mediaType || "image").startsWith("video") ? "video" : "image";
      const cost = Math.max(0, Math.min(parseInt(lockCost) || 0, MAX_LOCK_COST));
      const xrgeAmount = lockXrgeAmount ? String(parseFloat(lockXrgeAmount) || 0) : null;

      // Ensure lock_xrge_amount column exists
      await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS lock_xrge_amount TEXT DEFAULT NULL`.catch(() => {});

      const rows = await sql`
        INSERT INTO stories (user_id, media_url, media_type, caption, prompt, lock_cost, lock_xrge_amount)
        VALUES (${auth.userId}::uuid, ${mediaUrl}, ${type}, ${caption || ""}, ${prompt || ""}, ${cost}, ${xrgeAmount})
        RETURNING id, created_at, expires_at
      `;

      return res.status(200).json({ id: rows[0].id, created_at: rows[0].created_at, expires_at: rows[0].expires_at });
    } catch (err: any) {
      console.error("[stories] POST error:", err.message);
      return res.status(500).json({ error: "Failed to create story" });
    }
  }

  // GET — fetch active stories (requires auth)
  if (req.method === "GET") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Login required to view stories" });

      const viewerId = auth.userId;

      // Ensure story_likes table exists (safe for first deploy before migration)
      await sql`CREATE TABLE IF NOT EXISTS story_likes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(story_id, user_id)
      )`.catch(() => {});

      // Ensure lock_xrge_amount column exists
      await sql`ALTER TABLE stories ADD COLUMN IF NOT EXISTS lock_xrge_amount TEXT DEFAULT NULL`.catch(() => {});

      const rows = await sql`
        SELECT
          s.id, s.user_id, s.media_url, s.media_type, s.caption, s.prompt,
          s.created_at, s.expires_at, s.lock_cost,
          COALESCE(s.lock_xrge_amount, '') AS lock_xrge_amount,
          u.email,
          CASE WHEN sv.viewer_id IS NOT NULL THEN true ELSE false END AS viewed,
          (SELECT COUNT(*)::int FROM story_views sv2 WHERE sv2.story_id = s.id) AS view_count,
          CASE WHEN su.user_id IS NOT NULL THEN true ELSE false END AS unlocked,
          (SELECT COUNT(*)::int FROM story_likes sl WHERE sl.story_id = s.id) AS like_count,
          CASE WHEN EXISTS (SELECT 1 FROM story_likes sl2 WHERE sl2.story_id = s.id AND sl2.user_id = ${viewerId}::uuid) THEN true ELSE false END AS user_liked
        FROM stories s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = ${viewerId}::uuid
        LEFT JOIN story_unlocks su ON su.story_id = s.id AND su.user_id = ${viewerId}::uuid
        WHERE s.expires_at > now()
        ORDER BY s.created_at DESC
      `;

      // Group by user
      const grouped: Record<string, any> = {};
      for (const r of rows) {
        if (!grouped[r.user_id]) {
          const name = (r.email || "").split("@")[0] || "user";
          grouped[r.user_id] = {
            userId: r.user_id,
            username: name,
            stories: [],
            hasUnviewed: false,
          };
        }

        const isOwner = r.user_id === viewerId;
        const xrgePrice = parseFloat(r.lock_xrge_amount) || 0;
        const isLocked = (r.lock_cost > 0 || xrgePrice > 0) && !r.unlocked && !isOwner;

        grouped[r.user_id].stories.push({
          id: r.id,
          mediaUrl: isLocked ? "" : r.media_url,
          previewUrl: isLocked ? r.media_url : undefined,
          mediaType: r.media_type,
          caption: isLocked ? "" : r.caption,
          prompt: isLocked ? "" : r.prompt,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          viewed: r.viewed,
          viewCount: r.view_count || 0,
          likeCount: r.like_count || 0,
          userLiked: r.user_liked || false,
          lockCost: r.lock_cost,
          lockXrgeAmount: xrgePrice > 0 ? r.lock_xrge_amount : undefined,
          unlocked: r.unlocked || isOwner,
          isOwner,
        });
        if (!r.viewed) grouped[r.user_id].hasUnviewed = true;
      }

      return res.status(200).json({ users: Object.values(grouped) });
    } catch (err: any) {
      console.error("[stories] GET error:", err.message);
      return res.status(500).json({ error: "Failed to fetch stories" });
    }
  }

  // PATCH — unlock a locked story (pay credits)
  if (req.method === "PATCH") {
    try {
      const auth = getUserFromRequest(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const { storyId } = req.body || {};
      if (!storyId) return res.status(400).json({ error: "storyId required" });

      // Get the story
      const [story] = await sql`
        SELECT id, user_id, lock_cost FROM stories WHERE id = ${storyId}::uuid AND expires_at > now()
      `;
      if (!story) return res.status(404).json({ error: "Story not found or expired" });

      if (story.user_id === auth.userId) {
        return res.status(200).json({ ok: true, message: "Own story — no unlock needed" });
      }

      if (story.lock_cost <= 0) {
        return res.status(200).json({ ok: true, message: "Story is free" });
      }

      // Check if already unlocked
      const [existing] = await sql`
        SELECT id FROM story_unlocks WHERE story_id = ${storyId}::uuid AND user_id = ${auth.userId}::uuid
      `;
      if (existing) {
        return res.status(200).json({ ok: true, message: "Already unlocked" });
      }

      // Check user credits (use pack_credits first, then sub_credits, then daily_credits)
      const [user] = await sql`
        SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}::uuid
      `;
      if (!user) return res.status(404).json({ error: "User not found" });

      const totalCredits = (user.daily_credits || 0) + (user.sub_credits || 0) + (user.pack_credits || 0);
      if (totalCredits < story.lock_cost) {
        return res.status(402).json({ error: "Not enough credits", needed: story.lock_cost, available: totalCredits });
      }

      // Deduct credits (daily first, then sub, then pack)
      let remaining = story.lock_cost;
      let deductDaily = Math.min(remaining, user.daily_credits || 0);
      remaining -= deductDaily;
      let deductSub = Math.min(remaining, user.sub_credits || 0);
      remaining -= deductSub;
      let deductPack = remaining;

      await sql`
        UPDATE users SET
          daily_credits = daily_credits - ${deductDaily},
          sub_credits = sub_credits - ${deductSub},
          pack_credits = pack_credits - ${deductPack},
          updated_at = now()
        WHERE id = ${auth.userId}::uuid
      `;

      // Record unlock
      await sql`
        INSERT INTO story_unlocks (story_id, user_id, credits_paid)
        VALUES (${storyId}::uuid, ${auth.userId}::uuid, ${story.lock_cost})
        ON CONFLICT (story_id, user_id) DO NOTHING
      `;

      // Revenue split: 75% creator, 20% platform, 5% charity
      const creatorShare = Math.floor(story.lock_cost * 0.75);
      if (creatorShare > 0) {
        await sql`
          UPDATE users SET pack_credits = pack_credits + ${creatorShare}, updated_at = now()
          WHERE id = ${story.user_id}::uuid
        `;
      }

      return res.status(200).json({ ok: true, credited: story.lock_cost });
    } catch (err: any) {
      console.error("[stories] PATCH error:", err.message);
      return res.status(500).json({ error: "Failed to unlock story" });
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

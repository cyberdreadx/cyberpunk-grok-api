import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, checkBan } from "./_lib/auth";
import { getDb } from "./_lib/db";

const MAX_LOCK_COST = 100;
const MAX_LOCK_PRICE_CENTS = 10000; // $100 max

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // GET — list feed posts
  if (req.method === "GET") {
    try {
      const { filter, cursor, userId } = req.query;
      const limit = 20;

      // Ensure tables exist (safe for first deploy)
      await sql`CREATE TABLE IF NOT EXISTS feed_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(post_id, user_id)
      )`.catch(() => {});
      await sql`CREATE TABLE IF NOT EXISTS feed_moderators (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.catch(() => {});
      await sql`CREATE TABLE IF NOT EXISTS feed_unlocks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credits_paid INT NOT NULL DEFAULT 0,
        cents_paid INT NOT NULL DEFAULT 0,
        unlock_method TEXT NOT NULL DEFAULT 'credits',
        stripe_session_id TEXT,
        unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(post_id, user_id)
      )`.catch(() => {});

      // Add lock columns if missing (safe for pre-migration)
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_cost INT NOT NULL DEFAULT 0`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_price_cents INT NOT NULL DEFAULT 0`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_xrge_amount TEXT DEFAULT NULL`.catch(() => {});

      const selectCols = (authId: string) => sql`
        p.*, pr.username, pr.avatar_url,
        COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
        - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
        (SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${authId} LIMIT 1) AS user_vote,
        (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count,
        (SELECT count(*)::int FROM feed_reports WHERE post_id = p.id) AS flag_count,
        EXISTS(SELECT 1 FROM feed_reports WHERE post_id = p.id AND user_id = ${authId}) AS user_flagged,
        CASE WHEN EXISTS(SELECT 1 FROM feed_unlocks WHERE post_id = p.id AND user_id = ${authId}) THEN true ELSE false END AS unlocked
      `;

      let rows;
      if (userId) {
        rows = cursor
          ? await sql`
              SELECT ${selectCols(auth.userId)}
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id = ${userId} AND p.created_at < ${cursor}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `
          : await sql`
              SELECT ${selectCols(auth.userId)}
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id = ${userId}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `;
      } else if (filter === "following") {
        rows = cursor
          ? await sql`
              SELECT ${selectCols(auth.userId)}
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ${auth.userId})
                AND p.created_at < ${cursor}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `
          : await sql`
              SELECT ${selectCols(auth.userId)}
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ${auth.userId})
              ORDER BY p.created_at DESC LIMIT ${limit}
            `;
      } else {
        rows = cursor
          ? await sql`
              SELECT ${selectCols(auth.userId)}
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              WHERE p.created_at < ${cursor}
              ORDER BY p.created_at DESC LIMIT ${limit}
            `
          : await sql`
              SELECT ${selectCols(auth.userId)}
              FROM feed_posts p
              JOIN profiles pr ON pr.user_id = p.user_id
              ORDER BY p.created_at DESC LIMIT ${limit}
            `;
      }

      return res.json({
        posts: rows.map((r: any) => {
          const isOwner = r.user_id === auth.userId;
          const xrgePrice = parseFloat(r.lock_xrge_amount || "0") || 0;
          const isLocked = (r.lock_cost > 0 || r.lock_price_cents > 0 || xrgePrice > 0) && !r.unlocked && !isOwner;

          return {
            id: r.id,
            userId: r.user_id,
            username: r.username,
            avatarUrl: r.avatar_url,
            text: isLocked ? "" : r.text,
            imageUrl: isLocked ? null : r.image_url,
            previewImageUrl: isLocked && r.image_url ? r.image_url : undefined,
            previewText: isLocked && r.text ? r.text.slice(0, 60) + "..." : undefined,
            createdAt: r.created_at,
            score: r.score,
            userVote: r.user_vote || null,
            commentCount: r.comment_count,
            flagCount: r.flag_count,
            userFlagged: !!r.user_flagged,
            lockCost: r.lock_cost || 0,
            lockPriceCents: r.lock_price_cents || 0,
            lockXrgeAmount: xrgePrice > 0 ? r.lock_xrge_amount : undefined,
            unlocked: r.unlocked || isOwner,
            isOwner,
          };
        }),
        nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
      });
    } catch (err: any) {
      console.error("[feed GET]", err.message);
      return res.status(500).json({ error: "Failed to fetch feed" });
    }
  }

  // POST — create a post
  if (req.method === "POST") {
    try {
      // Check if user is banned
      const ban = await checkBan(sql, auth.userId);
      if (ban.banned) {
        return res.status(403).json({ error: "Your account has been suspended.", reason: ban.reason });
      }

      const { text, imageUrl, lockCost, lockPriceCents, lockXrgeAmount } = req.body || {};
      if (!text && !imageUrl) return res.status(400).json({ error: "Post must have text or image" });
      if (text && text.length > 2000) return res.status(400).json({ error: "Text too long (max 2000)" });

      const cost = Math.max(0, Math.min(parseInt(lockCost) || 0, MAX_LOCK_COST));
      const priceCents = Math.max(0, Math.min(parseInt(lockPriceCents) || 0, MAX_LOCK_PRICE_CENTS));
      const xrgeAmount = lockXrgeAmount ? String(Math.max(0, parseFloat(lockXrgeAmount) || 0)) : null;

      const rows = await sql`
        INSERT INTO feed_posts (user_id, text, image_url, lock_cost, lock_price_cents, lock_xrge_amount)
        VALUES (${auth.userId}, ${text || ""}, ${imageUrl || null}, ${cost}, ${priceCents}, ${xrgeAmount})
        RETURNING id, created_at
      `;
      return res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
    } catch (err: any) {
      console.error("[feed POST]", err.message);
      return res.status(500).json({ error: "Failed to create post" });
    }
  }

  // PATCH — unlock a locked post (pay credits)
  if (req.method === "PATCH") {
    try {
      const { postId } = req.body || {};
      if (!postId) return res.status(400).json({ error: "postId required" });

      const [post] = await sql`SELECT id, user_id, lock_cost, lock_price_cents FROM feed_posts WHERE id = ${postId}::uuid`;
      if (!post) return res.status(404).json({ error: "Post not found" });

      if (post.user_id === auth.userId) return res.status(200).json({ ok: true, message: "Own post" });
      if (post.lock_cost <= 0 && post.lock_price_cents <= 0) return res.status(200).json({ ok: true, message: "Post is free" });

      // Check already unlocked
      const [existing] = await sql`SELECT id FROM feed_unlocks WHERE post_id = ${postId}::uuid AND user_id = ${auth.userId}::uuid`;
      if (existing) return res.status(200).json({ ok: true, message: "Already unlocked" });

      if (post.lock_cost <= 0) {
        return res.status(400).json({ error: "This post can only be unlocked with a payment" });
      }

      // Check credits
      const [user] = await sql`SELECT daily_credits, sub_credits, pack_credits FROM users WHERE id = ${auth.userId}::uuid`;
      if (!user) return res.status(404).json({ error: "User not found" });

      const totalCredits = (user.daily_credits || 0) + (user.sub_credits || 0) + (user.pack_credits || 0);
      if (totalCredits < post.lock_cost) {
        return res.status(402).json({ error: "Not enough credits", needed: post.lock_cost, available: totalCredits });
      }

      // Deduct credits (daily → sub → pack)
      let remaining = post.lock_cost;
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

      await sql`
        INSERT INTO feed_unlocks (post_id, user_id, credits_paid, unlock_method)
        VALUES (${postId}::uuid, ${auth.userId}::uuid, ${post.lock_cost}, 'credits')
        ON CONFLICT (post_id, user_id) DO NOTHING
      `;

      // Revenue split: 75% creator, 20% platform, 5% charity
      const creatorShare = Math.floor(post.lock_cost * 0.75);
      if (creatorShare > 0) {
        await sql`
          UPDATE users SET pack_credits = pack_credits + ${creatorShare}, updated_at = now()
          WHERE id = ${post.user_id}::uuid
        `;
      }

      return res.status(200).json({ ok: true, credited: post.lock_cost });
    } catch (err: any) {
      console.error("[feed PATCH]", err.message);
      return res.status(500).json({ error: "Failed to unlock post" });
    }
  }

  // DELETE — delete own post (or any post if admin/mod)
  if (req.method === "DELETE") {
    try {
      const { postId } = req.body || {};
      if (!postId) return res.status(400).json({ error: "postId required" });

      const isAdmin = auth.email === (process.env.ADMIN_EMAIL || "cyberdreadx@proton.me");
      const modRows = await sql`SELECT 1 FROM feed_moderators WHERE user_id = ${auth.userId} LIMIT 1`;
      const isMod = modRows.length > 0;
      if (isAdmin || isMod) {
        await sql`DELETE FROM feed_posts WHERE id = ${postId}`;
      } else {
        await sql`DELETE FROM feed_posts WHERE id = ${postId} AND user_id = ${auth.userId}`;
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[feed DELETE]", err.message);
      return res.status(500).json({ error: "Failed to delete post" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
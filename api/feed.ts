import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, checkBan, ADMIN_EMAIL } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { hasPurchased, canPost, POSTING_GATE_MESSAGE } from "./_lib/purchaseGate";
import { isVerified, VERIFICATION_REQUIRED_MESSAGE } from "./_lib/verifiedGate";
import { resolvePreviewUrl } from "./_lib/preview-url";
import { notify } from "./_lib/notify";

const MAX_LOCK_COST = 100;
const MAX_LOCK_PRICE_CENTS = 10000; // $100 max

/** Strip full-res URLs for locked posts and logged-out teasers. */
function feedMediaFields(
  row: { image_url?: string | null; preview_image_url?: string | null },
  opts: { authUserId: string | null; isLocked: boolean; isOwner: boolean; publicFull?: boolean },
) {
  const preview = resolvePreviewUrl(row.preview_image_url, row.image_url) || undefined;
  const full = row.image_url || undefined;
  // publicFull: SFW-filtered requests (landing showcase) may show full media of
  // unlocked posts to logged-out visitors — old posts predate the -preview.webp
  // convention, so the derived preview URL often 404s and full is all there is.
  const showFull = opts.isOwner || (!opts.isLocked && (!!opts.authUserId || !!opts.publicFull));
  if (showFull) {
    return { imageUrl: full || null, previewImageUrl: preview };
  }
  // NEVER fall back to the full-res URL here — for locked posts that would
  // hand non-payers the paywalled media (feed POST generates a real preview
  // server-side when the client didn't supply one).
  return {
    imageUrl: null,
    previewImageUrl: preview,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();
  const auth = getUserFromRequest(req);
  // GET is public (logged-out users can browse the feed). Mutations require auth.
  if (req.method !== "GET" && !auth) return res.status(401).json({ error: "Unauthorized" });
  const authUserId: string | null = auth?.userId ?? null;

  // GET — list feed posts
  if (req.method === "GET") {
    try {
      const { filter, cursor, userId, sort, view, mediaType, sfw } = req.query;
      const limit = 20;
      const sortMode = (sort as string) || "hot"; // hot | top | new | trending
      const viewMode = (view as string) || "posts"; // posts | creators
      // Optional media filter: "video" returns only posts whose image_url ends in a video extension.
      const videoOnly = (mediaType as string) === "video";
      const videoCond = videoOnly ? sql`AND p.image_url ~* '\\.(mp4|webm|mov|m4v)(\\?|$)'` : sql``;
      // sfw=1      → drop posts flagged mature. Used by the signed-out feed and
      //              by anyone with the NSFW toggle off, so the media never even
      //              reaches the browser.
      // sfw=strict → additionally require that the poster has flagged something
      //              mature at least once.
      //
      // The strict tier exists because is_mature is self-reported and badly
      // under-applied: 161 of 292 posters have never flagged anything, leaving
      // ~336 unvetted posts that `sfw=1` happily returns. Someone who has used
      // the flag before has demonstrated they know the control exists, so their
      // unflagged posts are a far better bet. It's a heuristic, not a
      // guarantee — but it's the only signal in the data, since nothing here
      // classifies images.
      // NSFW is a paying-customer feature. A client-side toggle is a
      // preference, not a permission — anyone can drop the query param — so
      // eligibility is decided here and a non-payer is forced to sfw=1
      // whatever they asked for. `strict` is never downgraded: it's already
      // narrower, and the logged-out landing page depends on it.
      const nsfwAllowed = authUserId ? await hasPurchased(sql, authUserId) : false;
      const effectiveSfw = sfw === "strict" ? "strict" : nsfwAllowed ? sfw : "1";

      const sfwCond =
        effectiveSfw === "strict"
          ? sql`AND p.is_mature = false
                AND EXISTS (
                  SELECT 1 FROM feed_posts fp
                  WHERE fp.user_id = p.user_id AND fp.is_mature = true
                )`
          : effectiveSfw === "1"
            ? sql`AND p.is_mature = false`
            : sql``;

      // Ensure tables exist (safe for first deploy)
      await sql`CREATE TABLE IF NOT EXISTS feed_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(post_id, user_id)
      )`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS preview_image_url TEXT`.catch(() => {});
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
      await sql`CREATE TABLE IF NOT EXISTS feed_views (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(post_id, user_id)
      )`.catch(() => {});

      // Add lock columns if missing (safe for pre-migration)
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_cost INT NOT NULL DEFAULT 0`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_price_cents INT NOT NULL DEFAULT 0`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_xrge_amount TEXT DEFAULT NULL`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS is_mature BOOLEAN NOT NULL DEFAULT false`.catch(() => {});

      // ───── CREATORS VIEW: one row per author, ranked by recency + engagement ─────
      if (viewMode === "creators" && !userId) {
        const followingFilter = filter === "following" && authUserId
          ? sql`AND p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ${authUserId})`
          : sql``;
        const isTrending = sortMode === "trending";
        // Latest post per author + engagement signal.
        // Default ranking: recency + 7-day score.
        // Trending: 24h engagement (votes + comments + unlocks + views) with mild recency boost.
        const creatorRows = await sql`
          WITH latest AS (
            SELECT DISTINCT ON (p.user_id)
              p.id, p.user_id, p.text, p.image_url, p.preview_image_url, p.created_at,
              p.lock_cost, p.lock_price_cents, p.lock_xrge_amount
            FROM feed_posts p
            WHERE 1=1 ${followingFilter}
            ORDER BY p.user_id, p.created_at DESC
          ),
          stats AS (
            SELECT
              l.user_id,
              COALESCE((
                SELECT count(*)::int FROM feed_posts WHERE user_id = l.user_id
              ), 0) AS post_count,
              COALESCE((
                SELECT SUM(
                  CASE WHEN r.emoji = '👍' THEN 1 WHEN r.emoji = '👎' THEN -1 ELSE 0 END
                )::int
                FROM feed_reactions r
                JOIN feed_posts fp ON fp.id = r.post_id
                WHERE fp.user_id = l.user_id AND fp.created_at > now() - interval '7 days'
              ), 0) AS recent_score,
              COALESCE((
                SELECT (
                  COALESCE((
                    SELECT count(*)::int FROM feed_reactions r2
                    JOIN feed_posts fp2 ON fp2.id = r2.post_id
                    WHERE fp2.user_id = l.user_id
                      AND r2.created_at > now() - interval '24 hours'
                  ), 0) * 2
                  + COALESCE((
                    SELECT count(*)::int FROM feed_comments c
                    JOIN feed_posts fp3 ON fp3.id = c.post_id
                    WHERE fp3.user_id = l.user_id
                      AND c.created_at > now() - interval '24 hours'
                  ), 0) * 3
                  + COALESCE((
                    SELECT count(*)::int FROM feed_unlocks u2
                    JOIN feed_posts fp4 ON fp4.id = u2.post_id
                    WHERE fp4.user_id = l.user_id
                      AND u2.unlocked_at > now() - interval '24 hours'
                  ), 0) * 5
                  + COALESCE((
                    SELECT count(*)::int FROM feed_views v
                    JOIN feed_posts fp5 ON fp5.id = v.post_id
                    WHERE fp5.user_id = l.user_id
                      AND v.viewed_at > now() - interval '24 hours'
                  ), 0)
                )
              ), 0) AS trending_score
            FROM latest l
          )
          SELECT
            l.id AS latest_post_id,
            l.user_id,
            l.text AS latest_text,
            l.image_url AS latest_image,
            l.preview_image_url AS latest_preview,
            l.created_at AS latest_at,
            l.lock_cost, l.lock_price_cents, l.lock_xrge_amount,
            COALESCE((SELECT is_mature FROM feed_posts WHERE id = l.id), false) AS is_mature,
            pr.username, pr.avatar_url,
            (u.email = ${ADMIN_EMAIL} OR (u.verification_status = 'verified' AND (u.verification_renews_at IS NULL OR u.verification_renews_at > now()))) AS verified,
            s.post_count,
            s.recent_score,
            s.trending_score,
            ${isTrending
              ? sql`(
                  s.trending_score::float
                  + 1.0 / POWER(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 + 2, 0.8)
                )`
              : sql`(
                  1.0 / POWER(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 + 2, 1.2)
                  + LN(GREATEST(s.recent_score, 0) + 1) * 0.15
                )`} AS rank_score
          FROM latest l
          JOIN profiles pr ON pr.user_id = l.user_id
          JOIN users u ON u.id = l.user_id
          JOIN stats s ON s.user_id = l.user_id
          ${(() => {
            if (!cursor) return sql``;
            // Cursor format: "<rankScore>|<userId>". Falls back to legacy numeric-only cursors.
            const raw = String(cursor);
            const pipe = raw.indexOf("|");
            const scoreStr = pipe >= 0 ? raw.slice(0, pipe) : raw;
            const lastUserId = pipe >= 0 ? raw.slice(pipe + 1) : "";
            const scoreNum = parseFloat(scoreStr);
            const rankExpr = isTrending
              ? sql`(
                  s.trending_score::float
                  + 1.0 / POWER(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 + 2, 0.8)
                )`
              : sql`(
                  1.0 / POWER(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600.0 + 2, 1.2)
                  + LN(GREATEST(s.recent_score, 0) + 1) * 0.15
                )`;
            // Stable keyset pagination: rank_score DESC, then user_id ASC as tiebreaker
            return lastUserId
              ? sql`WHERE (${rankExpr} < ${scoreNum})
                       OR (${rankExpr} = ${scoreNum} AND l.user_id > ${lastUserId})`
              : sql`WHERE ${rankExpr} < ${scoreNum}`;
          })()}
          ORDER BY rank_score DESC, l.user_id ASC
          LIMIT ${limit}
        `;

        return res.json({
          creators: creatorRows.map((r: any) => {
            const xrgePrice = parseFloat(r.lock_xrge_amount || "0") || 0;
            const isOwner = authUserId ? r.user_id === authUserId : false;
            const isLocked = (r.lock_cost > 0 || r.lock_price_cents > 0 || xrgePrice > 0) && !isOwner;
            const media = feedMediaFields(
              { image_url: r.latest_image, preview_image_url: r.latest_preview },
              { authUserId, isLocked, isOwner },
            );
            return {
              userId: r.user_id,
              username: r.username,
              avatarUrl: r.avatar_url,
              verified: !!r.verified,
              postCount: r.post_count,
              recentScore: r.recent_score,
              latestPostId: r.latest_post_id,
              latestText: isLocked ? "" : r.latest_text,
              latestImage: media.imageUrl,
              previewImage: media.previewImageUrl,
              latestAt: r.latest_at,
              latestLocked: isLocked,
              isMature: !!r.is_mature,
              isOwner,
              lockCost: r.lock_cost || 0,
              lockPriceCents: r.lock_price_cents || 0,
              lockXrgeAmount: xrgePrice > 0 ? r.lock_xrge_amount : undefined,
              rankScore: parseFloat(r.rank_score),
            };
          }),
          nextCursor: creatorRows.length === limit
            ? `${creatorRows[creatorRows.length - 1].rank_score}|${creatorRows[creatorRows.length - 1].user_id}`
            : null,
        });
      }

      // For logged-out users, per-user fields (vote, flag, unlock) are always null/false.
      const selectCols = (authId: string | null) => sql`
        p.*, pr.username, pr.avatar_url,
        (uu.email = ${ADMIN_EMAIL} OR (uu.verification_status = 'verified' AND (uu.verification_renews_at IS NULL OR uu.verification_renews_at > now()))) AS author_verified,
        COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
        - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
        ${authId ? sql`(SELECT emoji FROM feed_reactions WHERE post_id = p.id AND user_id = ${authId} LIMIT 1)` : sql`NULL`} AS user_vote,
        (SELECT count(*)::int FROM feed_comments WHERE post_id = p.id) AS comment_count,
        (SELECT count(*)::int FROM feed_reports WHERE post_id = p.id) AS flag_count,
        ${authId ? sql`EXISTS(SELECT 1 FROM feed_reports WHERE post_id = p.id AND user_id = ${authId})` : sql`false`} AS user_flagged,
        ${authId ? sql`CASE WHEN EXISTS(SELECT 1 FROM feed_unlocks WHERE post_id = p.id AND user_id = ${authId}) THEN true ELSE false END` : sql`false`} AS unlocked,
        COALESCE((SELECT count(*)::int FROM feed_views WHERE post_id = p.id), 0) AS view_count
      `;

      // Build ORDER BY based on sort mode
      // Hot: score / (age_hours + 2)^1.5  — recent high-engagement posts rise
      // Top: pure score DESC
      // New: created_at DESC (default)
      const orderHot = sql`(
        (COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
         - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0)
         + COALESCE((SELECT count(*)::int FROM feed_comments WHERE post_id = p.id), 0) * 0.5
        ) / POWER(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 + 2, 1.5)
      ) DESC, p.created_at DESC`;
      const orderTop = sql`(
        COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👍'), 0)
        - COALESCE((SELECT count(*)::int FROM feed_reactions WHERE post_id = p.id AND emoji = '👎'), 0)
      ) DESC, p.created_at DESC`;
      const orderNew = sql`p.created_at DESC`;

      const orderBy = sortMode === "top" ? orderTop : sortMode === "new" ? orderNew : orderHot;

      let rows;
      const cursorCond = cursor ? sql`AND p.created_at < ${cursor}` : sql``;

      if (userId) {
        rows = await sql`
          SELECT ${selectCols(authUserId)}
          FROM feed_posts p
          JOIN profiles pr ON pr.user_id = p.user_id
          JOIN users uu ON uu.id = p.user_id
          WHERE p.user_id = ${userId} ${cursorCond} ${videoCond} ${sfwCond}
          ORDER BY ${orderBy} LIMIT ${limit}
        `;
      } else if (filter === "following" && authUserId) {
        rows = await sql`
          SELECT ${selectCols(authUserId)}
          FROM feed_posts p
          JOIN profiles pr ON pr.user_id = p.user_id
          JOIN users uu ON uu.id = p.user_id
          WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ${authUserId})
            ${cursorCond} ${videoCond} ${sfwCond}
          ORDER BY ${orderBy} LIMIT ${limit}
        `;
      } else {
        rows = await sql`
          SELECT ${selectCols(authUserId)}
          FROM feed_posts p
          JOIN profiles pr ON pr.user_id = p.user_id
          JOIN users uu ON uu.id = p.user_id
          WHERE 1=1 ${cursorCond} ${videoCond} ${sfwCond}
          ORDER BY ${orderBy} LIMIT ${limit}
        `;
      }

      // Record views before responding (Vercel kills after res.json). Only for logged-in users.
      const postIds = rows.map((r: any) => r.id);
      if (postIds.length > 0 && authUserId) {
        await Promise.all(
          postIds.map((pid: string) =>
            sql`INSERT INTO feed_views (post_id, user_id) VALUES (${pid}::uuid, ${authUserId}::uuid) ON CONFLICT (post_id, user_id) DO NOTHING`.catch(() => {})
          )
        ).catch(() => {});
      }

      return res.json({
        posts: rows.map((r: any) => {
          const isOwner = authUserId ? r.user_id === authUserId : false;
          const xrgePrice = parseFloat(r.lock_xrge_amount || "0") || 0;
          const isLocked = (r.lock_cost > 0 || r.lock_price_cents > 0 || xrgePrice > 0) && !r.unlocked && !isOwner;
          const media = feedMediaFields(
            { image_url: r.image_url, preview_image_url: r.preview_image_url },
            { authUserId, isLocked, isOwner, publicFull: sfw === "1" },
          );

          return {
            id: r.id,
            userId: r.user_id,
            username: r.username,
            avatarUrl: r.avatar_url,
            authorVerified: !!r.author_verified,
            text: isLocked ? "" : r.text,
            imageUrl: media.imageUrl,
            previewImageUrl: media.previewImageUrl,
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
            viewCount: r.view_count || 0,
            isMature: !!r.is_mature,
          };
        }),
        nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
        // Whether this viewer may turn NSFW on at all. Sent with the feed so
        // the toggle reflects what the server will actually honour rather than
        // a second call the UI could render ahead of.
        nsfwAllowed,
      });
    } catch (err: any) {
      console.error("[feed GET]", err.message);
      return res.status(500).json({ error: "Failed to fetch feed" });
    }
  }

  // POST — create a post
  if (req.method === "POST") {
    try {
      // Ensure lock columns exist
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_cost INT NOT NULL DEFAULT 0`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_price_cents INT NOT NULL DEFAULT 0`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS lock_xrge_amount TEXT DEFAULT NULL`.catch(() => {});
      await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS is_mature BOOLEAN NOT NULL DEFAULT false`.catch(() => {});
      await sql`CREATE TABLE IF NOT EXISTS feed_idempotency (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, idempotency_key)
      )`.catch(() => {});

      // Check if user is banned
      const ban = await checkBan(sql, auth.userId);
      if (ban.banned) {
        return res.status(403).json({ error: "Your account has been suspended.", reason: ban.reason });
      }

      // Posting gate: must have purchased OR earned enough karma
      if (!(await canPost(sql, auth.userId))) {
        return res.status(403).json({ error: POSTING_GATE_MESSAGE, code: "PURCHASE_REQUIRED" });
      }

      // ── Idempotency: if the client retries the same logical request, return
      // the existing post instead of creating a duplicate. We accept either an
      // `Idempotency-Key` header (preferred) or an idempotencyKey field in
      // the body. Keys are scoped per user and considered fresh for 24h.
      const headerKeyRaw = req.headers["idempotency-key"];
      const headerKey = Array.isArray(headerKeyRaw) ? headerKeyRaw[0] : headerKeyRaw;
      const bodyKey = (req.body && (req.body.idempotencyKey || req.body.idempotency_key)) || null;
      const idempotencyKey = (headerKey || bodyKey || "").toString().slice(0, 128).trim() || null;

      if (idempotencyKey) {
        const existing = await sql`
          SELECT p.id, p.created_at
          FROM feed_idempotency i
          JOIN feed_posts p ON p.id = i.post_id
          WHERE i.user_id = ${auth.userId}
            AND i.idempotency_key = ${idempotencyKey}
            AND i.created_at > now() - interval '24 hours'
          LIMIT 1
        `.catch(() => []);
        if (existing.length > 0) {
          return res.status(200).json({
            id: existing[0].id,
            createdAt: existing[0].created_at,
            idempotent: true,
          });
        }
      }

      const { text, imageUrl, previewImageUrl, lockCost, lockPriceCents, lockXrgeAmount, isMature } = req.body || {};
      if (!text && !imageUrl) return res.status(400).json({ error: "Post must have text or image" });
      if (text && text.length > 2000) return res.status(400).json({ error: "Text too long (max 2000)" });

      const cost = Math.max(0, Math.min(parseInt(lockCost) || 0, MAX_LOCK_COST));
      const priceCents = Math.max(0, Math.min(parseInt(lockPriceCents) || 0, MAX_LOCK_PRICE_CENTS));
      const xrgeAmount = lockXrgeAmount ? String(Math.max(0, parseFloat(lockXrgeAmount) || 0)) : null;
      const mature = !!isMature;

      // Verification gate: monetized posts (any non-zero lock) require an
      // ACTIVE creator verification subscription.
      const wantsMoney = cost > 0 || priceCents > 0 || (xrgeAmount && parseFloat(xrgeAmount) > 0);
      if (wantsMoney && !(await isVerified(sql, auth.userId))) {
        return res.status(403).json({ error: VERIFICATION_REQUIRED_MESSAGE, code: "VERIFICATION_REQUIRED" });
      }

      // Locked posts MUST have a real preview — the API never serves the
      // full-res URL to non-payers, so without one the post shows nothing.
      let finalPreviewUrl = previewImageUrl || null;
      if (wantsMoney && imageUrl && !finalPreviewUrl) {
        try {
          const { ensurePreviewForUrl } = await import("./_lib/ensure-preview");
          finalPreviewUrl = await ensurePreviewForUrl(imageUrl);
        } catch (err: any) {
          console.warn("[feed POST] preview generation failed:", err?.message);
        }
      }

      const rows = await sql`
        INSERT INTO feed_posts (user_id, text, image_url, preview_image_url, lock_cost, lock_price_cents, lock_xrge_amount, is_mature)
        VALUES (${auth.userId}, ${text || ""}, ${imageUrl || null}, ${finalPreviewUrl}, ${cost}, ${priceCents}, ${xrgeAmount}, ${mature})
        RETURNING id, created_at
      `;

      // Best-effort: record the idempotency mapping. If two requests race,
      // the unique PK prevents both from inserting; the loser sees a conflict
      // and silently moves on (the client still got a valid post back here).
      if (idempotencyKey) {
        await sql`
          INSERT INTO feed_idempotency (user_id, idempotency_key, post_id)
          VALUES (${auth.userId}, ${idempotencyKey}, ${rows[0].id})
          ON CONFLICT (user_id, idempotency_key) DO NOTHING
        `.catch(() => {});
      }

      return res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
    } catch (err: any) {
      console.error("[feed POST]", err.message);
      return res.status(500).json({ error: "Failed to create post" });
    }
  }

  // PATCH — unlock a locked post (pay credits) OR toggle is_mature flag
  if (req.method === "PATCH") {
    try {
      const { postId, action, isMature } = req.body || {};
      if (!postId) return res.status(400).json({ error: "postId required" });

      // ── Sub-action: toggle 18+ flag (owner / admin / mod) ──
      if (action === "set-mature") {
        const [target] = await sql`SELECT user_id FROM feed_posts WHERE id = ${postId}::uuid`;
        if (!target) return res.status(404).json({ error: "Post not found" });
        const isAdminUser = auth.email === (process.env.ADMIN_EMAIL || "cyberdreadx@proton.me");
        const modRows = await sql`SELECT 1 FROM feed_moderators WHERE user_id = ${auth.userId} LIMIT 1`;
        const allowed = target.user_id === auth.userId || isAdminUser || modRows.length > 0;
        if (!allowed) return res.status(403).json({ error: "Not allowed" });
        const next = !!isMature;
        await sql`UPDATE feed_posts SET is_mature = ${next} WHERE id = ${postId}::uuid`;
        return res.status(200).json({ ok: true, isMature: next });
      }

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

      // Guarded deduction: each statement autocommits on the Neon HTTP driver,
      // so without the balance predicate N concurrent unlocks of N different
      // posts all pass the check above and each deduct in full, taking the
      // balance negative while every unlock (and creator payout) still lands.
      const debited = await sql`
        UPDATE users SET
          daily_credits = daily_credits - ${deductDaily},
          sub_credits = sub_credits - ${deductSub},
          pack_credits = pack_credits - ${deductPack},
          updated_at = now()
        WHERE id = ${auth.userId}::uuid
          AND daily_credits >= ${deductDaily}
          AND sub_credits >= ${deductSub}
          AND pack_credits >= ${deductPack}
        RETURNING id
      ` as any[];
      if (debited.length === 0) {
        return res.status(402).json({ error: "Not enough credits", needed: post.lock_cost });
      }

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

      const [profile] = await sql`SELECT username, avatar_url FROM profiles WHERE user_id = ${auth.userId}::uuid`;
      await notify({
        userId: post.user_id,
        type: "unlock",
        title: `${profile?.username || "Someone"} unlocked your post`,
        body: `${post.lock_cost} credits`,
        actorId: auth.userId,
        actorUsername: profile?.username,
        actorAvatarUrl: profile?.avatar_url,
        refId: postId,
      });

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

      // Look up the media URLs BEFORE deleting so we can purge the files too.
      const mediaRows = isAdmin || isMod
        ? await sql`SELECT image_url, preview_image_url FROM feed_posts WHERE id = ${postId}`
        : await sql`SELECT image_url, preview_image_url FROM feed_posts WHERE id = ${postId} AND user_id = ${auth.userId}`;

      if (isAdmin || isMod) {
        await sql`DELETE FROM feed_posts WHERE id = ${postId}`;
      } else {
        await sql`DELETE FROM feed_posts WHERE id = ${postId} AND user_id = ${auth.userId}`;
      }

      // Best-effort: remove the underlying media files from Blob/R2.
      if (mediaRows.length > 0) {
        const { deleteMediaUrls } = await import("./_lib/media-delete");
        await deleteMediaUrls([mediaRows[0].image_url, mediaRows[0].preview_image_url]);
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[feed DELETE]", err.message);
      return res.status(500).json({ error: "Failed to delete post" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest, checkBan, ADMIN_EMAIL } from "./_lib/auth";
import { getDb } from "./_lib/db";

const MAX_PROMPT_LEN = 4000;
const MAX_TITLE_LEN = 120;
const MAX_NEGATIVE_LEN = 2000;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 32;

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => String(t || "").trim().slice(0, MAX_TAG_LEN))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sql = getDb();
  const auth = getUserFromRequest(req);
  if (req.method !== "GET" && !auth) return res.status(401).json({ error: "Unauthorized" });
  const authUserId: string | null = auth?.userId ?? null;

  if (req.method === "GET") {
    try {
      // Safe for first deploy before migration is applied manually
      await sql`CREATE TABLE IF NOT EXISTS prompt_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'text-to-image',
        tags TEXT[] NOT NULL DEFAULT '{}',
        example_image_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.catch(() => {});
      await sql`CREATE TABLE IF NOT EXISTS prompt_votes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES prompt_posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL CHECK (emoji IN ('👍', '👎')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (post_id, user_id)
      )`.catch(() => {});

      const { sort, cursor, userId } = req.query;
      const limit = 20;
      const sortMode = (sort as string) || "hot";

      const selectCols = (authId: string | null) => sql`
        p.*, pr.username, pr.avatar_url,
        (uu.email = ${ADMIN_EMAIL} OR (uu.verification_status = 'verified' AND (uu.verification_renews_at IS NULL OR uu.verification_renews_at > now()))) AS author_verified,
        COALESCE((SELECT count(*)::int FROM prompt_votes WHERE post_id = p.id AND emoji = '👍'), 0)
        - COALESCE((SELECT count(*)::int FROM prompt_votes WHERE post_id = p.id AND emoji = '👎'), 0) AS score,
        ${authId ? sql`(SELECT emoji FROM prompt_votes WHERE post_id = p.id AND user_id = ${authId} LIMIT 1)` : sql`NULL`} AS user_vote
      `;

      const orderHot = sql`(
        (COALESCE((SELECT count(*)::int FROM prompt_votes WHERE post_id = p.id AND emoji = '👍'), 0)
         - COALESCE((SELECT count(*)::int FROM prompt_votes WHERE post_id = p.id AND emoji = '👎'), 0)
        ) / POWER(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 + 2, 1.5)
      ) DESC, p.created_at DESC`;
      const orderTop = sql`(
        COALESCE((SELECT count(*)::int FROM prompt_votes WHERE post_id = p.id AND emoji = '👍'), 0)
        - COALESCE((SELECT count(*)::int FROM prompt_votes WHERE post_id = p.id AND emoji = '👎'), 0)
      ) DESC, p.created_at DESC`;
      const orderNew = sql`p.created_at DESC`;
      const orderBy = sortMode === "top" ? orderTop : sortMode === "new" ? orderNew : orderHot;

      const cursorCond = cursor ? sql`AND p.created_at < ${cursor}` : sql``;
      const userCond = userId ? sql`AND p.user_id = ${userId}` : sql``;

      const rows = await sql`
        SELECT ${selectCols(authUserId)}
        FROM prompt_posts p
        JOIN profiles pr ON pr.user_id = p.user_id
        JOIN users uu ON uu.id = p.user_id
        WHERE 1=1 ${cursorCond} ${userCond}
        ORDER BY ${orderBy}
        LIMIT ${limit}
      `;

      return res.json({
        prompts: rows.map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          avatarUrl: r.avatar_url,
          authorVerified: !!r.author_verified,
          title: r.title || "",
          prompt: r.prompt,
          negativePrompt: r.negative_prompt || "",
          mode: r.mode || "text-to-image",
          tags: r.tags || [],
          exampleImageUrl: r.example_image_url,
          createdAt: r.created_at,
          score: r.score,
          userVote: r.user_vote || null,
          isOwner: authUserId ? r.user_id === authUserId : false,
        })),
        nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
      });
    } catch (err: any) {
      console.error("[prompts GET]", err.message);
      return res.status(500).json({ error: "Failed to load prompts" });
    }
  }

  if (req.method === "POST") {
    try {
      const ban = await checkBan(sql, auth!.userId);
      if (ban.banned) {
        return res.status(403).json({ error: "Your account has been suspended.", reason: ban.reason });
      }

      const { title, prompt, negativePrompt, mode, tags, exampleImageUrl } = req.body || {};
      const promptText = String(prompt || "").trim();
      if (!promptText) return res.status(400).json({ error: "prompt required" });
      if (promptText.length > MAX_PROMPT_LEN) {
        return res.status(400).json({ error: `Prompt must be ${MAX_PROMPT_LEN} characters or less` });
      }

      const titleText = String(title || "").trim().slice(0, MAX_TITLE_LEN);
      const negativeText = String(negativePrompt || "").trim().slice(0, MAX_NEGATIVE_LEN);
      const modeText = String(mode || "text-to-image").trim().slice(0, 64) || "text-to-image";
      const tagList = normalizeTags(tags);
      const imageUrl = exampleImageUrl ? String(exampleImageUrl).trim().slice(0, 2048) : null;

      const inserted = await sql`
        INSERT INTO prompt_posts (user_id, title, prompt, negative_prompt, mode, tags, example_image_url)
        VALUES (
          ${auth!.userId},
          ${titleText},
          ${promptText},
          ${negativeText},
          ${modeText},
          ${tagList},
          ${imageUrl}
        )
        RETURNING id, created_at
      `;

      return res.status(201).json({ id: inserted[0].id, createdAt: inserted[0].created_at });
    } catch (err: any) {
      console.error("[prompts POST]", err.message);
      return res.status(500).json({ error: "Failed to share prompt" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { postId } = req.body || {};
      if (!postId) return res.status(400).json({ error: "postId required" });

      const isAdmin = auth!.email === ADMIN_EMAIL;
      if (isAdmin) {
        await sql`DELETE FROM prompt_posts WHERE id = ${postId}`;
      } else {
        await sql`DELETE FROM prompt_posts WHERE id = ${postId} AND user_id = ${auth!.userId}`;
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[prompts DELETE]", err.message);
      return res.status(500).json({ error: "Failed to delete prompt" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

/**
 * /api/easy-threads — chat history for Easy mode.
 *
 * GET  ?action=list                 → the caller's threads, newest touched first
 * GET  ?threadId=<id>               → one thread's messages, oldest first
 * POST { action: "create", title }  → new thread
 * POST { action: "append", threadId, role, text?, status?, assets?, label? }
 * POST { action: "update", messageId, status?, assets?, error? }
 * POST { action: "rename", threadId, title }
 * POST { action: "delete", threadId }
 *
 * Auth: Bearer JWT. Every statement is scoped by user_id as well as by id, so
 * a guessed thread id belonging to someone else returns nothing rather than
 * their conversation.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { checkRateLimit } from "./_lib/ratelimit";

/** Caps, so one account cannot grow this without bound. */
const MAX_THREADS = 100;
const MAX_MESSAGES = 300;
const MAX_TEXT = 4000;

interface Asset { url: string; previewUrl?: string; type: "image" | "video" }

/** Only the fields the client renders, and only from the storage we control. */
function cleanAssets(input: unknown): Asset[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      url: String(a.url || ""),
      previewUrl: a.previewUrl ? String(a.previewUrl) : undefined,
      type: a.type === "video" ? ("video" as const) : ("image" as const),
    }))
    .filter((a) => /^https?:\/\//i.test(a.url))
    .slice(0, 8);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Sign in first." });

  const sql = getDb();

  try {
    if (req.method === "GET") {
      const threadId = String(req.query.threadId || "");
      if (threadId) {
        const rows = await sql`
          SELECT m.id, m.role, m.text, m.status, m.error, m.assets, m.label, m.created_at
          FROM easy_messages m
          JOIN easy_threads t ON t.id = m.thread_id
          WHERE m.thread_id = ${threadId}::uuid AND t.user_id = ${auth.userId}::uuid
          ORDER BY m.created_at ASC
          LIMIT ${MAX_MESSAGES}
        ` as any[];
        return res.status(200).json({
          messages: rows.map((r) => ({
            id: r.id, role: r.role, text: r.text, status: r.status,
            error: r.error, assets: r.assets || [], label: r.label,
            createdAt: r.created_at,
          })),
        });
      }

      const threads = await sql`
        SELECT id, title, created_at, updated_at
        FROM easy_threads WHERE user_id = ${auth.userId}::uuid
        ORDER BY updated_at DESC LIMIT ${MAX_THREADS}
      ` as any[];
      return res.status(200).json({
        threads: threads.map((t) => ({
          id: t.id, title: t.title, createdAt: t.created_at, updatedAt: t.updated_at,
        })),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    // Generous, because a single send writes two rows and then updates one.
    const { allowed } = await checkRateLimit(
      `easy:${auth.userId}`, "easy-threads", { max: 240, windowSeconds: 60 },
    );
    if (!allowed) return res.status(429).json({ error: "Slow down a moment." });

    const body = (req.body || {}) as Record<string, any>;
    const action = String(body.action || "");

    if (action === "create") {
      const title = String(body.title || "New chat").slice(0, 120);
      const [t] = await sql`
        INSERT INTO easy_threads (user_id, title)
        VALUES (${auth.userId}::uuid, ${title})
        RETURNING id, title, created_at, updated_at
      ` as any[];
      // Keep the newest MAX_THREADS; the oldest fall off rather than pile up.
      await sql`
        DELETE FROM easy_threads WHERE user_id = ${auth.userId}::uuid AND id IN (
          SELECT id FROM easy_threads WHERE user_id = ${auth.userId}::uuid
          ORDER BY updated_at DESC OFFSET ${MAX_THREADS}
        )
      `.catch(() => { });
      return res.status(201).json({
        thread: { id: t.id, title: t.title, createdAt: t.created_at, updatedAt: t.updated_at },
      });
    }

    if (action === "append") {
      const threadId = String(body.threadId || "");
      const role = body.role === "result" ? "result" : "user";
      const [owned] = await sql`
        SELECT id FROM easy_threads
        WHERE id = ${threadId}::uuid AND user_id = ${auth.userId}::uuid
      ` as any[];
      if (!owned) return res.status(404).json({ error: "Thread not found" });

      const [m] = await sql`
        INSERT INTO easy_messages (thread_id, user_id, role, text, status, assets, label)
        VALUES (
          ${threadId}::uuid, ${auth.userId}::uuid, ${role},
          ${body.text ? String(body.text).slice(0, MAX_TEXT) : null},
          ${role === "result" ? (body.status || "running") : null},
          ${JSON.stringify(cleanAssets(body.assets))}::jsonb,
          ${body.label ? String(body.label).slice(0, 60) : null}
        )
        RETURNING id, created_at
      ` as any[];

      await sql`UPDATE easy_threads SET updated_at = now() WHERE id = ${threadId}::uuid`;
      return res.status(201).json({ id: m.id, createdAt: m.created_at });
    }

    if (action === "update") {
      const messageId = String(body.messageId || "");
      const [m] = await sql`
        UPDATE easy_messages SET
          status = COALESCE(${body.status ?? null}, status),
          error  = COALESCE(${body.error ?? null}, error),
          assets = CASE WHEN ${body.assets !== undefined}
                     THEN ${JSON.stringify(cleanAssets(body.assets))}::jsonb
                     ELSE assets END
        WHERE id = ${messageId}::uuid AND user_id = ${auth.userId}::uuid
        RETURNING id
      ` as any[];
      if (!m) return res.status(404).json({ error: "Message not found" });
      return res.status(200).json({ ok: true });
    }

    if (action === "rename") {
      const [t] = await sql`
        UPDATE easy_threads SET title = ${String(body.title || "").slice(0, 120)}, updated_at = now()
        WHERE id = ${String(body.threadId || "")}::uuid AND user_id = ${auth.userId}::uuid
        RETURNING id
      ` as any[];
      if (!t) return res.status(404).json({ error: "Thread not found" });
      return res.status(200).json({ ok: true });
    }

    if (action === "delete") {
      // Messages cascade. The renders themselves are untouched — they live in
      // the Library, and deleting a conversation must not delete someone's art.
      const [t] = await sql`
        DELETE FROM easy_threads
        WHERE id = ${String(body.threadId || "")}::uuid AND user_id = ${auth.userId}::uuid
        RETURNING id
      ` as any[];
      if (!t) return res.status(404).json({ error: "Thread not found" });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("[easy-threads]", err?.message);
    return res.status(500).json({ error: "Request failed." });
  }
}

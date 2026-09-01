/**
 * /api/dm — direct messages.
 *
 *   GET  /api/dm                          → my threads (newest first)
 *   GET  /api/dm?threadId=X&since=<iso>   → messages in a thread
 *   POST /api/dm            { toUserId, text }  → send (creates thread if needed)
 *   POST /api/dm?action=read { threadId }       → mark thread read
 *
 * Blocking lives in api/blocks.ts.
 *
 * Cost shape: the unread BADGE never hits this route — it rides on /api/pulse
 * via denormalised counters on dm_threads. This endpoint is only touched when
 * the user actually has the DM screen open.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { notify } from "./_lib/notify";

const MAX_TEXT = 2000;
const MAX_PAGE = 50;

/** Threads are keyed by the ordered pair — see migration 053. */
function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/* ── In-memory send limiter (no DB write on a user-initiated path) ── */
const g = globalThis as any;
if (!g.__dmRate) g.__dmRate = new Map<string, number[]>();
const rate: Map<string, number[]> = g.__dmRate;

function rateLimit(userId: string): { ok: boolean; retry?: number } {
  const now = Date.now();
  const arr = (rate.get(userId) || []).filter((t) => now - t < 60_000);
  if (arr.length && now - arr[arr.length - 1] < 800) return { ok: false, retry: 1 };
  if (arr.length >= 30) return { ok: false, retry: 60 };
  arr.push(now);
  rate.set(userId, arr);
  return { ok: true };
}

/**
 * Can `sender` open a NEW conversation with `recipient`?
 *
 * Open DMs on free signup is a solicitation-spam firehose, so a cold first
 * message requires either a paid account or that the recipient already follows
 * the sender. Once a thread exists both sides can reply freely — including the
 * free-tier recipient, who must always be able to answer.
 */
async function canInitiate(sql: any, senderId: string, recipientId: string): Promise<boolean> {
  const [row] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM follows
        WHERE follower_id = ${recipientId}::uuid AND following_id = ${senderId}::uuid
      ) AS recipient_follows_sender,
      (
        SELECT (u.stripe_customer_id IS NOT NULL OR u.subscription_tier IS NOT NULL)
        FROM users u WHERE u.id = ${senderId}::uuid
      ) AS sender_is_paid
  `;
  return !!(row?.recipient_follows_sender || row?.sender_is_paid);
}

/** True if either direction of the pair has a block in place. */
async function isBlocked(sql: any, a: string, b: string): Promise<boolean> {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM user_blocks
      WHERE (blocker_id = ${a}::uuid AND blocked_id = ${b}::uuid)
         OR (blocker_id = ${b}::uuid AND blocked_id = ${a}::uuid)
    ) AS blocked
  `;
  return !!row?.blocked;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();
  const me = auth.userId;

  try {
    /* ── GET ────────────────────────────────────────────────────────── */
    if (req.method === "GET") {
      const threadId = String(req.query.threadId || "").trim();

      // ── Thread list ──
      if (!threadId) {
        const rows = await sql`
          SELECT t.id,
                 t.last_message,
                 t.last_message_at,
                 t.last_sender_id,
                 CASE WHEN t.user_a = ${me}::uuid THEN t.unread_a ELSE t.unread_b END AS unread,
                 CASE WHEN t.user_a = ${me}::uuid THEN t.user_b ELSE t.user_a END AS other_id,
                 p.username AS other_username,
                 p.avatar_url AS other_avatar_url
          FROM dm_threads t
          LEFT JOIN profiles p
            ON p.user_id = CASE WHEN t.user_a = ${me}::uuid THEN t.user_b ELSE t.user_a END
          WHERE t.user_a = ${me}::uuid OR t.user_b = ${me}::uuid
          ORDER BY t.last_message_at DESC
          LIMIT 100
        `;
        return res.status(200).json({
          threads: (rows as any[]).map((r) => ({
            id: r.id,
            otherId: r.other_id,
            otherUsername: r.other_username || "user",
            otherAvatarUrl: r.other_avatar_url,
            lastMessage: r.last_message,
            lastMessageAt: r.last_message_at,
            lastSenderId: r.last_sender_id,
            unread: Number(r.unread || 0),
          })),
        });
      }

      // ── Messages in one thread ──
      const [thread] = await sql`
        SELECT id, user_a, user_b FROM dm_threads WHERE id = ${threadId}::uuid
      `;
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      if (thread.user_a !== me && thread.user_b !== me) {
        return res.status(403).json({ error: "Not your thread" });
      }

      const since = String(req.query.since || "").trim();
      const rows = since
        ? await sql`
            SELECT id, sender_id, text,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM dm_messages
            WHERE thread_id = ${threadId}::uuid AND created_at > ${since}::timestamptz
            ORDER BY created_at ASC LIMIT ${MAX_PAGE}
          `
        : await sql`
            SELECT id, sender_id, text,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM (
              SELECT id, sender_id, text, created_at FROM dm_messages
              WHERE thread_id = ${threadId}::uuid
              ORDER BY created_at DESC LIMIT ${MAX_PAGE}
            ) m ORDER BY created_at ASC
          `;

      return res.status(200).json({
        threadId,
        messages: (rows as any[]).map((r) => ({
          id: r.id,
          senderId: r.sender_id,
          text: r.text,
          createdAt: r.created_at,
          mine: r.sender_id === me,
        })),
      });
    }

    /* ── POST ───────────────────────────────────────────────────────── */
    if (req.method === "POST") {
      const action = String(req.query.action || "");
      const body = (req.body || {}) as { threadId?: string; toUserId?: string; text?: string };

      // ── Mark read ──
      if (action === "read") {
        const threadId = String(body.threadId || "").trim();
        if (!threadId) return res.status(400).json({ error: "threadId required" });
        // Zero only MY side; a single statement, so no read-then-write race
        // (the Neon HTTP driver autocommits — there is no transaction here).
        await sql`
          UPDATE dm_threads
          SET unread_a = CASE WHEN user_a = ${me}::uuid THEN 0 ELSE unread_a END,
              unread_b = CASE WHEN user_b = ${me}::uuid THEN 0 ELSE unread_b END
          WHERE id = ${threadId}::uuid AND (user_a = ${me}::uuid OR user_b = ${me}::uuid)
        `;
        return res.status(200).json({ ok: true });
      }

      // ── Send ──
      const text = String(body.text || "").trim();
      const toUserId = String(body.toUserId || "").trim();
      if (!toUserId) return res.status(400).json({ error: "toUserId required" });
      if (!text) return res.status(400).json({ error: "Empty message" });
      if (text.length > MAX_TEXT) return res.status(400).json({ error: `Max ${MAX_TEXT} chars` });
      if (toUserId === me) return res.status(400).json({ error: "Cannot message yourself" });

      const rl = rateLimit(me);
      if (!rl.ok) return res.status(429).json({ error: "Slow down", retry: rl.retry });

      const [recipient] = await sql`SELECT id FROM users WHERE id = ${toUserId}::uuid`;
      if (!recipient) return res.status(404).json({ error: "User not found" });

      if (await isBlocked(sql, me, toUserId)) {
        // Intentionally vague — don't confirm to a blocked sender that they
        // specifically were blocked.
        return res.status(403).json({ error: "You can't message this user." });
      }

      const [a, b] = orderPair(me, toUserId);
      const [existing] = await sql`
        SELECT id FROM dm_threads WHERE user_a = ${a}::uuid AND user_b = ${b}::uuid
      `;

      if (!existing && !(await canInitiate(sql, me, toUserId))) {
        return res.status(403).json({
          error: "You need a paid account to start a new conversation, or they need to follow you first.",
        });
      }

      // Upsert the thread and bump the RECIPIENT's unread counter in one
      // statement. ON CONFLICT makes a simultaneous first message from both
      // sides converge on one thread instead of erroring.
      const preview = text.slice(0, 140);
      const [thread] = await sql`
        INSERT INTO dm_threads (user_a, user_b, last_message, last_message_at, last_sender_id,
                                unread_a, unread_b)
        VALUES (
          ${a}::uuid, ${b}::uuid, ${preview}, now(), ${me}::uuid,
          ${a === me ? 0 : 1}, ${b === me ? 0 : 1}
        )
        ON CONFLICT (user_a, user_b) DO UPDATE
          SET last_message = EXCLUDED.last_message,
              last_message_at = now(),
              last_sender_id = ${me}::uuid,
              unread_a = CASE WHEN dm_threads.user_a = ${me}::uuid THEN dm_threads.unread_a ELSE dm_threads.unread_a + 1 END,
              unread_b = CASE WHEN dm_threads.user_b = ${me}::uuid THEN dm_threads.unread_b ELSE dm_threads.unread_b + 1 END
        RETURNING id
      `;

      const [msg] = await sql`
        INSERT INTO dm_messages (thread_id, sender_id, text)
        VALUES (${thread.id}::uuid, ${me}::uuid, ${text})
        -- Same full-precision shape as the GET, because the sender uses this
        -- value as their next poll cursor.
        RETURNING id, sender_id, text,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      `;

      // Notification + (throttled, opt-out-able) email. notify() never throws.
      const [profile] = await sql`
        SELECT username, avatar_url FROM profiles WHERE user_id = ${me}::uuid
      `;
      await notify({
        userId: toUserId,
        type: "dm",
        title: `${profile?.username || "Someone"} sent you a message`,
        body: preview,
        actorId: me,
        actorUsername: profile?.username,
        actorAvatarUrl: profile?.avatar_url,
        refId: thread.id,
        link: "/messages",
      });

      return res.status(200).json({
        ok: true,
        threadId: thread.id,
        message: {
          id: msg.id,
          senderId: msg.sender_id,
          text: msg.text,
          createdAt: msg.created_at,
          mine: true,
        },
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    console.error("[dm]", e?.message || e);
    return res.status(500).json({ error: "Message failed" });
  }
}

/**
 * Persistent ephemeral chat — topic channels, last 100 msgs per channel kept,
 * stored in Neon (chat_messages table). Auth required for both read & write.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { neon } from "@neondatabase/serverless";

export const CHANNELS = ["general", "help", "showcase", "nsfw"] as const;
type Channel = typeof CHANNELS[number];

const MAX_PER_CHANNEL = 100;
const MAX_TEXT = 500;

// Per-user simple rate limit: 1 msg/sec, 20/min (best-effort, in-memory)
const g = globalThis as any;
if (!g.__chatRate) g.__chatRate = new Map<string, number[]>();
const rate: Map<string, number[]> = g.__chatRate;

function rateLimit(userId: string): { ok: boolean; retry?: number } {
  const now = Date.now();
  const arr = (rate.get(userId) || []).filter((t) => now - t < 60_000);
  if (arr.length && now - arr[arr.length - 1] < 1000) return { ok: false, retry: 1 };
  if (arr.length >= 20) return { ok: false, retry: 60 };
  arr.push(now);
  rate.set(userId, arr);
  return { ok: true };
}

let schemaReady = false;
async function ensureSchema(sql: ReturnType<typeof neon>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT PRIMARY KEY,
      channel     TEXT NOT NULL,
      user_id     UUID NOT NULL,
      username    TEXT NOT NULL,
      text        TEXT NOT NULL,
      ts          BIGINT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_ts ON chat_messages (channel, ts DESC)`;
  schemaReady = true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  if (!process.env.DATABASE_URL) return res.status(500).json({ error: "DB not configured" });
  const sql = neon(process.env.DATABASE_URL);
  try { await ensureSchema(sql); } catch (e: any) {
    return res.status(500).json({ error: "Schema init failed", detail: String(e?.message || e) });
  }

  // Lightweight summary mode: latest ts per channel for unread badges.
  if (req.method === "GET" && (req.query.summary === "1" || req.query.summary === "true")) {
    try {
      const rows = await sql`
        SELECT channel, COUNT(*)::int AS count, COALESCE(MAX(ts), 0)::bigint AS latest
        FROM chat_messages GROUP BY channel
      `;
      const map = new Map<string, { count: number; latest: number }>();
      for (const r of rows as any[]) map.set(r.channel, { count: Number(r.count), latest: Number(r.latest) });
      return res.status(200).json({
        channels: CHANNELS.map((c) => ({
          id: c,
          count: map.get(c)?.count || 0,
          latest: map.get(c)?.latest || 0,
        })),
      });
    } catch (e: any) {
      return res.status(500).json({ error: "Summary failed", detail: String(e?.message || e) });
    }
  }

  const channel = String(req.query.channel || "general") as Channel;
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Invalid channel" });

  if (req.method === "GET") {
    const since = Number(req.query.since || 0);
    try {
      const rows = since
        ? await sql`SELECT id, channel, user_id, username, text, ts FROM chat_messages WHERE channel = ${channel} AND ts > ${since} ORDER BY ts ASC LIMIT ${MAX_PER_CHANNEL}`
        : await sql`SELECT * FROM (SELECT id, channel, user_id, username, text, ts FROM chat_messages WHERE channel = ${channel} ORDER BY ts DESC LIMIT ${MAX_PER_CHANNEL}) t ORDER BY ts ASC`;
      const messages = (rows as any[]).map((r) => ({
        id: r.id, channel: r.channel, userId: r.user_id, username: r.username, text: r.text, ts: Number(r.ts),
      }));
      return res.status(200).json({
        channel,
        messages,
        channels: CHANNELS.map((c) => ({ id: c })),
      });
    } catch (e: any) {
      return res.status(500).json({ error: "Read failed", detail: String(e?.message || e) });
    }
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as { text?: string };
    const text = String(body.text || "").trim();
    if (!text) return res.status(400).json({ error: "Empty message" });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Max ${MAX_TEXT} chars` });

    const rl = rateLimit(user.userId);
    if (!rl.ok) return res.status(429).json({ error: "Slow down", retry: rl.retry });

    let username = (user.email || "anon").split("@")[0];
    try {
      const rows = await sql`SELECT username FROM profiles WHERE user_id = ${user.userId}::uuid LIMIT 1`;
      if ((rows as any[])[0]?.username) username = String((rows as any[])[0].username);
    } catch { /* fall back */ }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = Date.now();
    try {
      await sql`
        INSERT INTO chat_messages (id, channel, user_id, username, text, ts)
        VALUES (${id}, ${channel}, ${user.userId}::uuid, ${username}, ${text}, ${ts})
      `;
      // Trim channel to last MAX_PER_CHANNEL — best effort
      await sql`
        DELETE FROM chat_messages
        WHERE channel = ${channel}
          AND id NOT IN (
            SELECT id FROM chat_messages WHERE channel = ${channel}
            ORDER BY ts DESC LIMIT ${MAX_PER_CHANNEL}
          )
      `;
    } catch (e: any) {
      return res.status(500).json({ error: "Write failed", detail: String(e?.message || e) });
    }

    return res.status(200).json({
      ok: true,
      message: { id, channel, userId: user.userId, username, text, ts },
    });
  }

  if (req.method === "DELETE") {
    if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
    try {
      await sql`DELETE FROM chat_messages WHERE channel = ${channel}`;
    } catch (e: any) {
      return res.status(500).json({ error: "Clear failed", detail: String(e?.message || e) });
    }
    return res.status(200).json({ ok: true, cleared: channel });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

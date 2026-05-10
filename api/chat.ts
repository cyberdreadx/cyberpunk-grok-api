/**
 * Persistent ephemeral chat — topic channels, last 100 msgs per channel,
 * stored in Neon (chat_messages). Includes admin moderation:
 *   - DELETE /api/chat?id=<msg_id>          (admin: delete one message)
 *   - DELETE /api/chat?channel=<c>          (admin: clear channel)
 *   - POST   /api/chat?action=ban           (admin: ban user from channel or "*")
 *   - POST   /api/chat?action=unban         (admin)
 *   - GET    /api/chat?action=bans          (admin: list active bans)
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { neon } from "@neondatabase/serverless";

export const CHANNELS = ["general", "help", "showcase", "nsfw"] as const;
type Channel = typeof CHANNELS[number];

const MAX_PER_CHANNEL = 100;
const MAX_TEXT = 500;

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
      id TEXT PRIMARY KEY, channel TEXT NOT NULL, user_id UUID NOT NULL,
      username TEXT NOT NULL, text TEXT NOT NULL, ts BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_ts ON chat_messages (channel, ts DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_bans (
      user_id UUID NOT NULL,
      channel TEXT NOT NULL,
      reason TEXT,
      until_ts BIGINT,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, channel)
    )`;
  schemaReady = true;
}

async function isBanned(sql: any, userId: string, channel: Channel): Promise<{ banned: boolean; reason?: string; until?: number }> {
  const now = Date.now();
  const rows = await sql`
    SELECT channel, reason, until_ts FROM chat_bans
    WHERE user_id = ${userId}::uuid AND (channel = ${channel} OR channel = '*')
      AND (until_ts IS NULL OR until_ts > ${now})
    LIMIT 1`;
  const r = (rows as any[])[0];
  if (!r) return { banned: false };
  return { banned: true, reason: r.reason || undefined, until: r.until_ts ? Number(r.until_ts) : undefined };
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

  const isAdmin = user.email === ADMIN_EMAIL;
  const action = String(req.query.action || "");

  // ── Admin: list bans ──
  if (req.method === "GET" && action === "bans") {
    if (!isAdmin) return res.status(403).json({ error: "Forbidden" });
    const now = Date.now();
    const rows = await sql`
      SELECT b.user_id, b.channel, b.reason, b.until_ts, b.created_at,
             COALESCE(p.username, '') AS username
      FROM chat_bans b
      LEFT JOIN profiles p ON p.user_id = b.user_id
      WHERE (b.until_ts IS NULL OR b.until_ts > ${now})
      ORDER BY b.created_at DESC LIMIT 200`;
    return res.status(200).json({ bans: rows });
  }

  // ── Admin: ban / unban ──
  if (req.method === "POST" && (action === "ban" || action === "unban")) {
    if (!isAdmin) return res.status(403).json({ error: "Forbidden" });
    const body = (req.body || {}) as { userId?: string; channel?: string; hours?: number; reason?: string };
    const userId = String(body.userId || "").trim();
    const ch = String(body.channel || "*").trim();
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (ch !== "*" && !CHANNELS.includes(ch as Channel)) return res.status(400).json({ error: "Invalid channel" });

    if (action === "unban") {
      await sql`DELETE FROM chat_bans WHERE user_id = ${userId}::uuid AND channel = ${ch}`;
      return res.status(200).json({ ok: true });
    }
    const hours = Number(body.hours);
    const until = hours && hours > 0 ? Date.now() + hours * 3600_000 : null;
    const reason = String(body.reason || "").slice(0, 200) || null;
    await sql`
      INSERT INTO chat_bans (user_id, channel, reason, until_ts, created_by)
      VALUES (${userId}::uuid, ${ch}, ${reason}, ${until}, ${user.userId}::uuid)
      ON CONFLICT (user_id, channel) DO UPDATE
        SET reason = EXCLUDED.reason, until_ts = EXCLUDED.until_ts, created_by = EXCLUDED.created_by, created_at = NOW()`;
    return res.status(200).json({ ok: true });
  }

  // ── Summary (unread badges) ──
  if (req.method === "GET" && (req.query.summary === "1" || req.query.summary === "true")) {
    const rows = await sql`
      SELECT channel, COUNT(*)::int AS count, COALESCE(MAX(ts),0)::bigint AS latest
      FROM chat_messages GROUP BY channel`;
    const map = new Map<string, { count: number; latest: number }>();
    for (const r of rows as any[]) map.set(r.channel, { count: Number(r.count), latest: Number(r.latest) });
    return res.status(200).json({
      channels: CHANNELS.map((c) => ({
        id: c, count: map.get(c)?.count || 0, latest: map.get(c)?.latest || 0,
      })),
    });
  }

  const channel = String(req.query.channel || "general") as Channel;
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Invalid channel" });

  if (req.method === "GET") {
    const since = Number(req.query.since || 0);
    const rows = since
      ? await sql`SELECT id, channel, user_id, username, text, ts FROM chat_messages WHERE channel = ${channel} AND ts > ${since} ORDER BY ts ASC LIMIT ${MAX_PER_CHANNEL}`
      : await sql`SELECT * FROM (SELECT id, channel, user_id, username, text, ts FROM chat_messages WHERE channel = ${channel} ORDER BY ts DESC LIMIT ${MAX_PER_CHANNEL}) t ORDER BY ts ASC`;
    const messages = (rows as any[]).map((r) => ({
      id: r.id, channel: r.channel, userId: r.user_id, username: r.username, text: r.text, ts: Number(r.ts),
    }));
    return res.status(200).json({ channel, messages, channels: CHANNELS.map((c) => ({ id: c })) });
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as { text?: string };
    const text = String(body.text || "").trim();
    if (!text) return res.status(400).json({ error: "Empty message" });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Max ${MAX_TEXT} chars` });

    const rl = rateLimit(user.userId);
    if (!rl.ok) return res.status(429).json({ error: "Slow down", retry: rl.retry });

    const ban = await isBanned(sql, user.userId, channel);
    if (ban.banned) return res.status(403).json({
      error: ban.until
        ? `You're muted in this channel until ${new Date(ban.until).toLocaleString()}${ban.reason ? ` — ${ban.reason}` : ""}`
        : `You're muted in this channel${ban.reason ? ` — ${ban.reason}` : ""}`,
    });

    let username = (user.email || "anon").split("@")[0];
    try {
      const rows = await sql`SELECT username FROM profiles WHERE user_id = ${user.userId}::uuid LIMIT 1`;
      if ((rows as any[])[0]?.username) username = String((rows as any[])[0].username);
    } catch { /* fall back */ }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = Date.now();
    await sql`
      INSERT INTO chat_messages (id, channel, user_id, username, text, ts)
      VALUES (${id}, ${channel}, ${user.userId}::uuid, ${username}, ${text}, ${ts})`;
    await sql`
      DELETE FROM chat_messages WHERE channel = ${channel}
        AND id NOT IN (SELECT id FROM chat_messages WHERE channel = ${channel} ORDER BY ts DESC LIMIT ${MAX_PER_CHANNEL})`;
    return res.status(200).json({ ok: true, message: { id, channel, userId: user.userId, username, text, ts } });
  }

  if (req.method === "DELETE") {
    if (!isAdmin) return res.status(403).json({ error: "Forbidden" });
    const id = String(req.query.id || "").trim();
    if (id) {
      await sql`DELETE FROM chat_messages WHERE id = ${id}`;
      return res.status(200).json({ ok: true, deleted: id });
    }
    await sql`DELETE FROM chat_messages WHERE channel = ${channel}`;
    return res.status(200).json({ ok: true, cleared: channel });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

/**
 * Lightweight ephemeral chat — topic channels, last 100 msgs per channel,
 * in-memory ring buffer (no DB). Auth required for both read & write.
 *
 * Caveat: Vercel runs multiple isolated instances, so users may briefly see
 * different views until messages propagate via repeated polling. Acceptable
 * for a casual chat room and keeps cost at zero.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { neon } from "@neondatabase/serverless";

export const CHANNELS = ["general", "help", "showcase", "nsfw"] as const;
type Channel = typeof CHANNELS[number];

interface ChatMessage {
  id: string;
  channel: Channel;
  userId: string;
  username: string;
  text: string;
  ts: number;
}

const MAX_PER_CHANNEL = 100;
const MAX_TEXT = 500;

// Module-level store survives warm invocations on the same instance.
const g = globalThis as any;
if (!g.__chatStore) {
  g.__chatStore = new Map<Channel, ChatMessage[]>();
  for (const c of CHANNELS) g.__chatStore.set(c, []);
}
const store: Map<Channel, ChatMessage[]> = g.__chatStore;

// Per-user simple rate limit: 1 msg/sec, 20/min
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const channel = String(req.query.channel || "general") as Channel;
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Invalid channel" });

  if (req.method === "GET") {
    const since = Number(req.query.since || 0);
    const all = store.get(channel) || [];
    const messages = since ? all.filter((m) => m.ts > since) : all.slice(-MAX_PER_CHANNEL);
    return res.status(200).json({
      channel,
      messages,
      channels: CHANNELS.map((c) => ({ id: c, count: (store.get(c) || []).length })),
    });
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as { text?: string };
    const text = String(body.text || "").trim();
    if (!text) return res.status(400).json({ error: "Empty message" });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Max ${MAX_TEXT} chars` });

    const rl = rateLimit(user.userId);
    if (!rl.ok) return res.status(429).json({ error: "Slow down", retry: rl.retry });

    // Look up display name
    let username = (user.email || "anon").split("@")[0];
    try {
      if (process.env.DATABASE_URL) {
        const sql = neon(process.env.DATABASE_URL);
        const rows = await sql`SELECT username FROM profiles WHERE user_id = ${user.userId}::uuid LIMIT 1`;
        if (rows[0]?.username) username = String(rows[0].username);
      }
    } catch { /* fall back to email handle */ }

    const msg: ChatMessage = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      channel,
      userId: user.userId,
      username,
      text,
      ts: Date.now(),
    };
    const arr = store.get(channel) || [];
    arr.push(msg);
    if (arr.length > MAX_PER_CHANNEL) arr.splice(0, arr.length - MAX_PER_CHANNEL);
    store.set(channel, arr);
    return res.status(200).json({ ok: true, message: msg });
  }

  if (req.method === "DELETE") {
    // Admin-only: clear a channel
    if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
    store.set(channel, []);
    return res.status(200).json({ ok: true, cleared: channel });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

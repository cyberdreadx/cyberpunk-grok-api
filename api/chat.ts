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
import { getDb } from "./_lib/db";
import { handleCharacterChatMessage } from "./_lib/character-chat-message";
import { getHolderState } from "./v1/_lib/xrge-holder";

/** Character chat sends large base64 images; channel chat stays small. */
export const config = {
  maxDuration: 90,
  api: { bodyParser: { sizeLimit: "12mb" } },
};

export const CHANNELS = ["general", "help", "showcase", "nsfw"] as const;
type Channel = typeof CHANNELS[number];

const MAX_PER_CHANNEL = 100;
const MAX_TEXT = 500;

// ── @gltch in-chat AI bot ──
const BOT_USER_ID = "00000000-0000-0000-0000-0000000067c4"; // reserved bot UUID
const BOT_USERNAME = "gltch";
const BOT_TRIGGER = /(^|\s)@gltch\b/i;

const BOT_SYSTEM = `You are GLTCH, the in-chat AI assistant inside GLTCH Runner — an uncensored AI image + video generator and adult creator platform. Reply in a terse neon-cyberpunk tone, usually 1–3 short sentences. No markdown headers; only tiny lists. Answer ONLY from the facts below; if something isn't covered, say you're not sure and point to support@grokrunner.ai. Never invent features, prices, or limits.

== WHAT IT IS ==
Generate uncensored AI images & video, follow/support creators, and chat with AI personas. Modes: text→image, image edit, text→video, animate (image→video). Flow: pick mode + engine at the top of the generate form, type a prompt, hit Generate. Results go to your library — post, lock, or download them.

== ENGINES ==
- Images/edits: GLTCH (default) and GLTCH PRO (premium quality). No "Grok" engine — it was removed.
- Video: GLTCH WAN (default, 15 cr), LongLook (chained multi-clip long video, 20 cr), Seedance Lite/Fast/Pro (hosted, 3/8/25 cr per second). Optional "Ambient Sound" toggle adds synced SFX via MMAudio.
- NSFW video LoRAs are gated: unlock all for a one-time $30, OR hold XRGE (Runner tier+).

== CREDIT COSTS ==
Images ~3 cr, GLTCH edit ~5 cr (HD 7), WAN video 15 cr, LongLook 20 cr, Seedance 3–25 cr/sec. Purchased credits (pack or subscription) never expire.

== GETTING CREDITS ==
- Subscriptions = monthly BONUS CREDITS (best value, beat every pack): Basic $9→150/mo, Premium $19→325, Pro $39→675, Elite $79→1400. Subs also get 10 daily credits, daily missions, the spin wheel, and NSFW/GLTCH PRO access.
- One-time packs: Starter 75/$6.99, Pro 240/$18.99, Mega 600/$42.99, Ultra 2600/$179.99, Enterprise 5400/$359.99.
- Free credits: daily missions (~5 cr each, r/grok mission 25, +50 for a 7-day streak — SUBSCRIBERS ONLY), the daily spin wheel (1–10 cr), and referrals (your friend gets 3 on signup; you get 10 when they first buy).
- Daily credits (10/day) are SUBSCRIBERS ONLY — free users get no daily refill, so they earn via spin/referrals or buy packs.

== XRGE HOLDER PERKS (hold the $XRGE token; separate from subscriptions) ==
Tiers by amount held, with a continuous-hold streak multiplier up to x2: Initiate ≥1M (+5% gen discount), Operative ≥10M (+10%, +2 daily), Runner ≥50M (+15%, +5 daily, NSFW LoRAs unlocked), Architect ≥250M (+25%, +10 daily, GLTCH PRO unlocked). Selling below a tier resets the streak.

== CREATORS & PAYOUTS ==
Verified badge is $4.99/mo; verified creators can be featured in the directory. Creators earn CASH (75% share) from locked feed-post/story unlocks, fan persona chat, and XRGE tips. Withdraw via payouts: XRGE instant ($1 min), Stripe instant ($5 min), or PayPal/bank/crypto manual ($25 min, admin-reviewed).
Persona chat: 3 free texts/day with a creator's official AI persona, then ~1 cr/msg; selfies/videos cost extra; personas can generate images/clips mid-conversation.

== CONTENT POLICY ==
Adult / NSFW content IS allowed — that's the point. Hard lines are auto-enforced and always blocked: anything sexualizing minors, and illegal content. Never help anyone bypass those.

== COMMON ISSUES ==
- Out of credits → earn via spin/missions/referrals, buy a pack, or subscribe.
- Video slow / didn't return → video takes ~30–120s; wait, then retry once. If it persists, try a shorter duration or a different engine.
- NSFW LoRA locked → unlock for $30 or reach XRGE Runner tier.
- Can't post / sell → posting needs a paid account (any purchase); selling & payouts need creator verification.

== YOU CAN ==
1) Answer site questions from the facts above. If a "USER CONTEXT" line is provided, use it to answer personally (e.g. how many gens their balance affords) — but never recite it unprompted.
2) Craft prompts: when asked to make/generate an image or video, output ONE vivid refined prompt (under 60 words) wrapped EXACTLY as ⟦prompt⟧the prompt text⟦/prompt⟧ for a one-click Generate button.
3) Light moderation advice if asked (advisory only).
You CANNOT ban, charge, change accounts, or generate media yourself — you only craft the prompt. If unsure, say so.`;

/**
 * Build a short LIVE per-user context line so @gltch can answer personally
 * (real balance, plan, XRGE tier, creator status). Best-effort — returns "" on any failure.
 */
async function getBotUserContext(sql: any, userId: string): Promise<string> {
  try {
    const [u] = await sql`
      SELECT daily_credits, sub_credits, pack_credits, subscription_tier, verification_status
      FROM users WHERE id = ${userId}::uuid
    `;
    if (!u) return "";
    const balance = (u.daily_credits || 0) + (u.sub_credits || 0) + (u.pack_credits || 0);
    const plan = u.subscription_tier ? `${u.subscription_tier} subscriber` : "free (no subscription)";
    const verified = u.verification_status === "verified" ? "yes" : "no";

    let holder = "none";
    try {
      const h = await getHolderState(sql, userId);
      if (h && h.tier.id !== "none") {
        const unlocks = h.tier.id === "architect"
          ? ", NSFW LoRAs + GLTCH PRO unlocked"
          : h.tier.id === "runner"
            ? ", NSFW LoRAs unlocked"
            : "";
        holder = `${h.tier.name} (+${h.tier.dailyCreditBonus} daily${unlocks})`;
      }
    } catch { /* holder lookup is optional */ }

    const imgs = Math.floor(balance / 3);
    const vids = Math.floor(balance / 15);
    return `USER CONTEXT (the person you're replying to — use to answer personally, never recite unprompted): balance ≈ ${balance} credits (~${imgs} images or ~${vids} WAN videos); plan = ${plan}; XRGE tier = ${holder}; verified creator = ${verified}.`;
  } catch {
    return "";
  }
}

async function callBotAI(userText: string, channel: Channel, recent: { username: string; text: string }[], userCtx = ""): Promise<string> {
  const context = recent.slice(-6).map((m) => `${m.username}: ${m.text}`).join("\n");
  const userContent = `[#${channel}] Recent chat:\n${context}\n\nMessage to you: ${userText}`;
  const messages = [
    { role: "system" as const, content: BOT_SYSTEM },
    ...(userCtx ? [{ role: "system" as const, content: userCtx }] : []),
    { role: "user" as const, content: userContent },
  ];
  const payload = {
    messages,
    max_tokens: 280,
    temperature: 0.6,
  };

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    const model =
      process.env.CHAT_LOBBY_DEEPSEEK_MODEL ||
      process.env.CHARACTER_CHAT_TEXT_MODEL_DS ||
      "deepseek-chat";
    try {
      const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
        body: JSON.stringify({ model, ...payload }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 429) return "[gltch is rate-limited, try again in a moment]";
      if (!r.ok) return "[gltch glitched out, try again]";
      const data = await r.json();
      return String(data?.choices?.[0]?.message?.content || "").trim().slice(0, 800) || "[no reply]";
    } catch {
      return "[gltch timed out]";
    }
  }

  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) return "[gltch offline — AI key not configured]";
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        ...payload,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 429) return "[gltch is rate-limited, try again in a moment]";
    if (r.status === 402) return "[gltch is out of credits — ping admin]";
    if (!r.ok) return "[gltch glitched out, try again]";
    const data = await r.json();
    return String(data?.choices?.[0]?.message?.content || "").trim().slice(0, 800) || "[no reply]";
  } catch {
    return "[gltch timed out]";
  }
}

async function postBotReply(sql: any, channel: Channel, text: string) {
  const id = `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ts = Date.now();
  await sql`
    INSERT INTO chat_messages (id, channel, user_id, username, text, ts)
    VALUES (${id}, ${channel}, ${BOT_USER_ID}::uuid, ${BOT_USERNAME}, ${text}, ${ts})`;
  await sql`
    DELETE FROM chat_messages WHERE channel = ${channel}
      AND id NOT IN (SELECT id FROM chat_messages WHERE channel = ${channel} ORDER BY ts DESC LIMIT ${MAX_PER_CHANNEL})`;
  return { id, channel, userId: BOT_USER_ID, username: BOT_USERNAME, text, ts };
}

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
    const body = (req.body || {}) as { text?: string; action?: string; characterId?: string };
    // AI character companion chat (IndexedDB history client-side; LLM here)
    if (body.action === "message" && body.characterId) {
      try {
        const sqlChar = getDb();
        await handleCharacterChatMessage(req, res, user, sqlChar);
      } catch (e: any) {
        console.error("[chat] character message", e?.message || e);
        if (!res.writableEnded) res.status(500).json({ error: "Character chat failed" });
      }
      return;
    }

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

    let botMessage: any = undefined;
    if (BOT_TRIGGER.test(text)) {
      try {
        const recentRows = await sql`
          SELECT username, text FROM chat_messages
          WHERE channel = ${channel} ORDER BY ts DESC LIMIT 6`;
        const recent = (recentRows as any[]).reverse().map((r) => ({ username: r.username, text: r.text }));
        const userMsgClean = text.replace(BOT_TRIGGER, " ").trim() || text;
        const userCtx = await getBotUserContext(sql, user.userId);
        const reply = await callBotAI(userMsgClean, channel, recent, userCtx);
        botMessage = await postBotReply(sql, channel, reply);
      } catch (e) {
        // bot failures are silent — user message already saved
      }
    }

    return res.status(200).json({
      ok: true,
      message: { id, channel, userId: user.userId, username, text, ts },
      botMessage,
    });
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

/**
 * /api/pulse — consolidated poll endpoint.
 *
 * The client used to run four independent timers (credits 30s, notification
 * unread 20s, notification bell 30s, chat summary 20s). Each hit its own route,
 * and every one of those routes opened with a `checkRateLimit` upsert — a WRITE
 * on the hot path — before doing any real work. That was ~28 statements/min per
 * logged-in user to render two badges and a number that changes a few times a day.
 *
 * This endpoint replaces all of them:
 *   - ONE per-user statement (balance + unread notification count in a subselect)
 *   - the channel summary is identical for every user, so it's process-cached and
 *     costs one query per CACHE_MS across the whole server, not one per user
 *   - rate limiting is in-memory (see chat.ts for the same pattern) — a poll
 *     endpoint must not write to the DB just to answer "nothing changed"
 *
 * Credits are returned as a cheap signature, not the full payload. The client
 * refetches /api/credits only when the signature actually moves, so the
 * expensive route (discount stacking, XRGE holder state, free-credit config)
 * runs on change instead of on a timer.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { applyCors } from "./_lib/cors";

/** Keep in sync with CHANNELS in api/chat.ts. Redeclared so this hot path
 *  doesn't pull in the character-chat / XRGE holder module tree. */
const CHANNELS = ["general", "help", "showcase", "nsfw"] as const;

/** Channel activity is global — one query serves every polling client. */
const SUMMARY_CACHE_MS = 15_000;
let summaryCache: { value: { id: string; latest: number }[]; expiresAt: number } | null = null;

async function getChannelSummary(sql: any): Promise<{ id: string; latest: number }[]> {
  const now = Date.now();
  if (summaryCache && summaryCache.expiresAt > now) return summaryCache.value;

  try {
    const rows = await sql`
      SELECT channel, COALESCE(MAX(ts), 0)::bigint AS latest
      FROM chat_messages
      GROUP BY channel
    `;
    const map = new Map<string, number>();
    for (const r of rows as any[]) map.set(r.channel, Number(r.latest));
    const value = CHANNELS.map((c) => ({ id: c, latest: map.get(c) || 0 }));
    summaryCache = { value, expiresAt: now + SUMMARY_CACHE_MS };
    return value;
  } catch {
    // Serve the stale value rather than failing the whole pulse.
    if (summaryCache) return summaryCache.value;
    return CHANNELS.map((c) => ({ id: c, latest: 0 }));
  }
}

/* ── In-memory rate limit ──────────────────────────────────────────────
 * Deliberately NOT the DB-backed checkRateLimit: this endpoint exists to
 * make polling cheap, and a rate_limits upsert per poll is a dirty page +
 * WAL write per user per interval. Generous ceiling — the client polls at
 * 20s, so anything under ~120/min is a client bug, not abuse.
 */
const g = globalThis as any;
if (!g.__pulseRate) g.__pulseRate = new Map<string, number[]>();
const rate: Map<string, number[]> = g.__pulseRate;

function rateLimit(userId: string): boolean {
  const now = Date.now();
  const arr = (rate.get(userId) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 120) return false;
  arr.push(now);
  rate.set(userId, arr);
  // Opportunistic sweep so the map can't grow unbounded across long uptimes.
  if (rate.size > 5000) {
    for (const [k, v] of rate) {
      if (!v.length || now - v[v.length - 1] > 120_000) rate.delete(k);
    }
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  if (!rateLimit(auth.userId)) return res.status(429).json({ error: "Slow down" });

  const sql = getDb();

  try {
    // One statement: balance + tier + unread notifications.
    let row: any;
    try {
      const rows = await sql`
        SELECT u.daily_credits, u.sub_credits, u.pack_credits, u.subscription_tier,
               (SELECT COUNT(*)::int FROM notifications n
                 WHERE n.user_id = u.id AND n.read = false) AS notif_unread,
               -- Two separate SUMs rather than one OR'd scan, so each side can
               -- use its own index (idx_dm_threads_a / _b). Counts are
               -- denormalised onto the thread, so this never touches dm_messages.
               ((SELECT COALESCE(SUM(unread_a), 0)::int FROM dm_threads WHERE user_a = u.id)
              + (SELECT COALESCE(SUM(unread_b), 0)::int FROM dm_threads WHERE user_b = u.id)
               ) AS dm_unread
        FROM users u
        WHERE u.id = ${auth.userId}
      `;
      row = (rows as any[])[0];
    } catch {
      // notifications / dm_threads missing (migration not applied) — degrade, don't 500.
      const rows = await sql`
        SELECT daily_credits, sub_credits, pack_credits, subscription_tier,
               0 AS notif_unread, 0 AS dm_unread
        FROM users WHERE id = ${auth.userId}
      `;
      row = (rows as any[])[0];
    }

    if (!row) return res.status(404).json({ error: "User not found" });

    const channels = await getChannelSummary(sql);

    const daily = Number(row.daily_credits || 0);
    const sub = Number(row.sub_credits || 0);
    const pack = Number(row.pack_credits || 0);

    // Never cache a per-user response at the CDN/proxy layer.
    res.setHeader("Cache-Control", "private, no-store");

    return res.status(200).json({
      ts: Date.now(),
      // Signature only — the client refetches /api/credits when this moves.
      credits: {
        total: daily + sub + pack,
        daily,
        sub,
        pack,
        tier: row.subscription_tier ?? null,
      },
      notifUnread: Number(row.notif_unread || 0),
      dmUnread: Number(row.dm_unread || 0),
      channels,
    });
  } catch (err: any) {
    console.error("[pulse]", err?.message || err);
    return res.status(500).json({ error: "Pulse failed" });
  }
}

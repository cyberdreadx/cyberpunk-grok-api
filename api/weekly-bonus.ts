import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

/**
 * Weekly free credits: 10 credits per 7-day rolling window for ANY authenticated
 * user (verified or not, subscriber or not). Uses users.weekly_credits_claimed_at.
 */
const REWARD = 10;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "weekly-bonus", { max: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();

  try {
    const [u] = await sql`
      SELECT weekly_credits_claimed_at FROM users WHERE id = ${auth.userId} LIMIT 1
    `;
    const last = u?.weekly_credits_claimed_at ? new Date(u.weekly_credits_claimed_at).getTime() : 0;
    const nextAvailableAt = last ? new Date(last + WINDOW_MS).toISOString() : null;
    const claimable = !last || Date.now() - last >= WINDOW_MS;

    if (req.method === "GET") {
      return res.status(200).json({
        reward: REWARD,
        claimable,
        lastClaimedAt: u?.weekly_credits_claimed_at || null,
        nextAvailableAt,
      });
    }

    if (req.method === "POST") {
      if (!claimable) {
        return res.status(409).json({
          error: "Weekly bonus already claimed",
          nextAvailableAt,
        });
      }

      // Atomic claim — only updates if the window has elapsed (prevents double-grant races).
      const updated = await sql`
        UPDATE users
        SET pack_credits = pack_credits + ${REWARD},
            weekly_credits_claimed_at = now(),
            updated_at = now()
        WHERE id = ${auth.userId}
          AND (weekly_credits_claimed_at IS NULL
               OR weekly_credits_claimed_at <= now() - interval '7 days')
        RETURNING weekly_credits_claimed_at
      `;
      if (!updated.length) {
        return res.status(409).json({ error: "Weekly bonus already claimed" });
      }
      return res.status(200).json({
        credited: REWARD,
        nextAvailableAt: new Date(Date.now() + WINDOW_MS).toISOString(),
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[weekly-bonus]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

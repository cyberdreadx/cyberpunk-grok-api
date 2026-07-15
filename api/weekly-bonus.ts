import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

/**
 * Weekly free credits: 10 credits per 7-day rolling window. Requires a verified
 * email and a 48h-old account (anti account-cycling: throwaway accounts were
 * farming this — 305 claims by <7d-old accounts in one week, 2026-07).
 * Uses users.weekly_credits_claimed_at.
 */
const REWARD = 10;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_ACCOUNT_AGE_MS = 48 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "weekly-bonus", { max: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();

  try {
    const [u] = await sql`
      SELECT weekly_credits_claimed_at, email_verified, created_at
      FROM users WHERE id = ${auth.userId} LIMIT 1
    `;
    const last = u?.weekly_credits_claimed_at ? new Date(u.weekly_credits_claimed_at).getTime() : 0;
    const nextAvailableAt = last ? new Date(last + WINDOW_MS).toISOString() : null;
    const accountAgeMs = u?.created_at ? Date.now() - new Date(u.created_at).getTime() : 0;
    const eligible = !!u?.email_verified && accountAgeMs >= MIN_ACCOUNT_AGE_MS;
    const ineligibleReason = !u?.email_verified
      ? "Verify your email to claim the weekly bonus"
      : accountAgeMs < MIN_ACCOUNT_AGE_MS
        ? "Weekly bonus unlocks 48 hours after signup"
        : null;
    const claimable = eligible && (!last || Date.now() - last >= WINDOW_MS);

    if (req.method === "GET") {
      return res.status(200).json({
        reward: REWARD,
        claimable,
        lastClaimedAt: u?.weekly_credits_claimed_at || null,
        nextAvailableAt,
        ...(ineligibleReason ? { ineligibleReason } : {}),
      });
    }

    if (req.method === "POST") {
      if (!eligible) {
        return res.status(403).json({ error: ineligibleReason });
      }
      if (!claimable) {
        return res.status(409).json({
          error: "Weekly bonus already claimed",
          nextAvailableAt,
        });
      }

      // Atomic claim — only updates if the window has elapsed (prevents double-grant
      // races) and re-checks eligibility server-side.
      const updated = await sql`
        UPDATE users
        SET pack_credits = pack_credits + ${REWARD},
            weekly_credits_claimed_at = now(),
            updated_at = now()
        WHERE id = ${auth.userId}
          AND email_verified = true
          AND created_at <= now() - interval '48 hours'
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

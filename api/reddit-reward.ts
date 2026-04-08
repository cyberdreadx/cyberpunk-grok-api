/**
 * POST /api/reddit-reward — Claim 10 free pack credits by entering a secret
 * code posted in the r/GrokRunner subreddit.
 *
 * Body: { code: string }
 * Returns: { success: true, credits: 10 } on success
 *
 * Guards:
 *   - Auth required
 *   - Rate limited (5 attempts per 10 min per user)
 *   - Code checked against REDDIT_REWARD_CODE env var
 *   - One claim per account (reddit_reward_claimed flag in users table)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { checkRateLimit } from "./_lib/ratelimit";

const REWARD_CREDITS = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = getUserFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const rewardCode = process.env.REDDIT_REWARD_CODE;
  if (!rewardCode) {
    return res.status(503).json({ error: "Reddit reward is not configured" });
  }

  const { code } = req.body || {};
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    return res.status(400).json({ error: "Code is required" });
  }

  // Rate limit: 5 attempts per 10 minutes
  const { allowed } = await checkRateLimit(auth.userId, "reddit-reward", {
    max: 5,
    windowSeconds: 600,
  });
  if (!allowed) {
    return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." });
  }

  // Validate code (case-insensitive, trimmed)
  if (code.trim().toLowerCase() !== rewardCode.trim().toLowerCase()) {
    return res.status(403).json({ error: "Invalid code. Check the r/GrokRunner subreddit for the correct code." });
  }

  // Atomic: only grant if not already claimed
  try {
    const sql = getDb();
    const rows = await sql`
      UPDATE users
      SET pack_credits = pack_credits + ${REWARD_CREDITS},
          reddit_reward_claimed = true,
          updated_at = now()
      WHERE id = ${auth.userId}::uuid
        AND reddit_reward_claimed = false
      RETURNING id
    `;

    if (rows.length === 0) {
      return res.status(409).json({ error: "You've already claimed this reward." });
    }

    console.log(`[reddit-reward] Granted ${REWARD_CREDITS} pack credits to ${auth.userId}`);
    return res.status(200).json({ success: true, credits: REWARD_CREDITS });
  } catch (err: any) {
    console.error("[reddit-reward] DB error:", err.message);
    return res.status(500).json({ error: "Failed to claim reward. Please try again." });
  }
}

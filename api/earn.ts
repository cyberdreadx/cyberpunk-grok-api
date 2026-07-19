import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, checkBan } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";
import { logCreditGrant } from "./_lib/credit-ledger";

/**
 * /api/earn — engagement-based free credits (2026-07 earn-only overhaul).
 *
 * Replaces every automatic faucet (signup grant, weekly drop, follow-X,
 * reddit code). Credits are earned from RECEIVED engagement only — karma
 * events other users generate on your content. `like_given` and mission
 * karma are deliberately excluded: anything a user can self-generate at
 * scale must not mint credits.
 *
 * Sources:
 *  - Karma milestones (one-time, lifetime ladder on received karma)
 *  - Weekly engagement payout: floor(received_karma_7d / 4), cap 15/week
 *
 * Both are idempotent via one_time_claims.claim_key and audit-logged in
 * credit_ledger. Grants land in pack_credits (same as missions/pot).
 */

const QUALIFIED_REASONS = ["upvote_received", "story_like_received", "comment_received"];

/** threshold (received karma) → one-time credit reward */
const MILESTONES: Array<{ threshold: number; credits: number }> = [
  { threshold: 25, credits: 5 },
  { threshold: 50, credits: 5 },
  { threshold: 100, credits: 10 },
  { threshold: 250, credits: 15 },
  { threshold: 500, credits: 25 },
  { threshold: 1000, credits: 40 },
  { threshold: 2500, credits: 75 },
];

const WEEKLY_DIVISOR = 4;
const WEEKLY_CAP = 15;
const MIN_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

async function getQualifiedKarma(sql: any, userId: string): Promise<{ lifetime: number; last7d: number }> {
  const [row] = await sql`
    SELECT
      COALESCE(SUM(delta), 0)::int AS lifetime,
      COALESCE(SUM(delta) FILTER (WHERE created_at > now() - interval '7 days'), 0)::int AS last7d
    FROM karma_events
    WHERE user_id = ${userId}::uuid AND reason = ANY(${QUALIFIED_REASONS})
  `;
  return { lifetime: row?.lifetime ?? 0, last7d: row?.last7d ?? 0 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "earn", { max: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();

  try {
    const ban = await checkBan(sql, auth.userId);
    if (ban.banned) return res.status(403).json({ error: "Account suspended" });

    const [u] = await sql`
      SELECT email_verified, created_at FROM users WHERE id = ${auth.userId} LIMIT 1
    `;
    if (!u) return res.status(404).json({ error: "User not found" });
    const verified = !!u.email_verified;
    const oldEnough = Date.now() - new Date(u.created_at).getTime() >= MIN_ACCOUNT_AGE_MS;

    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_one_time_claims_user_key
              ON one_time_claims (user_id, claim_key)`.catch(() => {});

    const { lifetime, last7d } = await getQualifiedKarma(sql, auth.userId);
    const [{ week }] = await sql`SELECT to_char(now(), 'IYYY-IW') AS week`;
    const weeklyKey = `earn_wk_${week}`;

    const claimedRows = await sql`
      SELECT claim_key FROM one_time_claims
      WHERE user_id = ${auth.userId}
        AND (claim_key LIKE 'earn_ms_%' OR claim_key = ${weeklyKey})
    `;
    const claimed = new Set(claimedRows.map((r: any) => r.claim_key));
    const weeklyAvailable = Math.min(Math.floor(last7d / WEEKLY_DIVISOR), WEEKLY_CAP);

    const eligible = verified && oldEnough;

    if (req.method === "GET") {
      return res.status(200).json({
        qualifiedKarma: lifetime,
        qualifiedKarma7d: last7d,
        eligible,
        eligibilityReason: !verified ? "verify_email" : !oldEnough ? "account_too_new" : null,
        milestones: MILESTONES.map((m) => ({
          ...m,
          reached: lifetime >= m.threshold,
          claimed: claimed.has(`earn_ms_${m.threshold}`),
        })),
        weekly: {
          week,
          available: weeklyAvailable,
          claimed: claimed.has(weeklyKey),
          divisor: WEEKLY_DIVISOR,
          cap: WEEKLY_CAP,
        },
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!eligible) {
      return res.status(403).json({
        error: !verified
          ? "Verify your email to earn credits."
          : "Account must be at least 3 days old to earn credits.",
      });
    }

    const { action, threshold } = req.body || {};

    if (action === "claim_milestone") {
      const ms = MILESTONES.find((m) => m.threshold === Number(threshold));
      if (!ms) return res.status(400).json({ error: "Unknown milestone" });
      if (lifetime < ms.threshold) {
        return res.status(400).json({ error: `Milestone not reached yet (${lifetime}/${ms.threshold} karma)` });
      }
      const key = `earn_ms_${ms.threshold}`;
      // Idempotent: grant only when the claim row is newly inserted.
      const inserted = await sql`
        INSERT INTO one_time_claims (user_id, claim_key, credits)
        VALUES (${auth.userId}::uuid, ${key}, ${ms.credits})
        ON CONFLICT (user_id, claim_key) DO NOTHING
        RETURNING id
      `;
      if (!inserted.length) return res.status(409).json({ error: "Already claimed" });
      await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${ms.credits})`;
      await logCreditGrant(sql, auth.userId, ms.credits, "earn_milestone", key);
      return res.status(200).json({ credited: ms.credits, milestone: ms.threshold });
    }

    if (action === "claim_weekly") {
      if (weeklyAvailable < 1) {
        return res.status(400).json({
          error: `Not enough engagement this week yet (${last7d} karma — need at least ${WEEKLY_DIVISOR}).`,
        });
      }
      const inserted = await sql`
        INSERT INTO one_time_claims (user_id, claim_key, credits)
        VALUES (${auth.userId}::uuid, ${weeklyKey}, ${weeklyAvailable})
        ON CONFLICT (user_id, claim_key) DO NOTHING
        RETURNING id
      `;
      if (!inserted.length) return res.status(409).json({ error: "Already claimed this week" });
      await sql`SELECT add_pack_credits(${auth.userId}::uuid, ${weeklyAvailable})`;
      await logCreditGrant(sql, auth.userId, weeklyAvailable, "earn_weekly", weeklyKey);
      return res.status(200).json({ credited: weeklyAvailable, week });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("[earn]", err.message);
    return res.status(500).json({ error: "Failed to process earn request" });
  }
}

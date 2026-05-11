import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

/**
 * One-time follow-on-X bonus: 10 credits for following @cyberdreadx and @rougecoin.
 * No verification (X API requires elevated access) — self-attest by clicking the
 * follow links and then claiming. Idempotent via one_time_claims.claim_key.
 */
const CLAIM_KEY = "follow_x_cyberdreadx_rougecoin";
const REWARD = 10;
const ACCOUNTS = ["cyberdreadx", "rougecoin"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "follow-bonus", { max: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();

  try {
    if (req.method === "GET") {
      const [row] = await sql`
        SELECT id, created_at FROM one_time_claims
        WHERE user_id = ${auth.userId} AND claim_key = ${CLAIM_KEY}
        LIMIT 1
      `;
      return res.status(200).json({
        claimKey: CLAIM_KEY,
        accounts: ACCOUNTS,
        reward: REWARD,
        claimed: !!row,
        claimedAt: row?.created_at || null,
      });
    }

    if (req.method === "POST") {
      try {
        await sql`
          INSERT INTO one_time_claims (user_id, claim_key, credits)
          VALUES (${auth.userId}, ${CLAIM_KEY}, ${REWARD})
        `;
      } catch (e: any) {
        // Unique violation → already claimed
        if (String(e?.code) === "23505" || /duplicate|unique/i.test(e?.message || "")) {
          return res.status(409).json({ error: "Bonus already claimed" });
        }
        throw e;
      }

      await sql`
        UPDATE users SET pack_credits = pack_credits + ${REWARD}, updated_at = now()
        WHERE id = ${auth.userId}
      `;

      return res.status(200).json({ credited: REWARD, claimKey: CLAIM_KEY });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[follow-bonus]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

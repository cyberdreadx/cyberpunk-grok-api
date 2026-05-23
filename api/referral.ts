/**
 * /api/referral - Referral system endpoints.
 * POST { action: "get-code" } -> returns user's referral code (generates if missing)
 * POST { action: "stats" }    -> returns referral stats for the user
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import crypto from "crypto";

/** Generate an 8-char alphanumeric referral code. */
function generateReferralCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();
  const { action } = req.body || {};

  try {
    switch (action) {
      case "get-code": {
        // Check if user already has a referral code
        const [user] = await sql`
          SELECT referral_code FROM users WHERE id = ${auth.userId}::uuid
        `;
        if (!user) return res.status(404).json({ error: "User not found" });

        if (user.referral_code) {
          return res.status(200).json({ code: user.referral_code });
        }

        // Generate a unique code (retry on collision)
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateReferralCode();
          try {
            await sql`
              UPDATE users SET referral_code = ${code}, updated_at = now()
              WHERE id = ${auth.userId}::uuid AND referral_code IS NULL
            `;
            return res.status(200).json({ code });
          } catch (err: any) {
            if (err.code === "23505") continue; // unique violation, retry
            throw err;
          }
        }
        return res.status(500).json({ error: "Failed to generate referral code" });
      }

      case "stats": {
        const [stats] = await sql`
          SELECT
            COUNT(*)::int AS total_referred,
            COUNT(*) FILTER (WHERE referee_verified)::int AS total_verified,
            COUNT(*) FILTER (WHERE referee_purchased)::int AS total_purchased,
            COUNT(*) FILTER (WHERE referrer_rewarded)::int AS total_rewarded,
            COUNT(*) FILTER (WHERE referee_subscribed)::int AS total_subscribed
          FROM referrals
          WHERE referrer_id = ${auth.userId}::uuid
        `;

        // Calculate total credits earned from referrals
        const creditsEarned = (stats?.total_rewarded || 0) * 10;

        // Get user's referral code + lifetime free months earned
        const [user] = await sql`
          SELECT referral_code, COALESCE(free_months_earned, 0)::int AS free_months_earned
          FROM users WHERE id = ${auth.userId}::uuid
        `;

        return res.status(200).json({
          code: user?.referral_code || null,
          totalReferred: stats?.total_referred || 0,
          totalVerified: stats?.total_verified || 0,
          totalPurchased: stats?.total_purchased || 0,
          totalRewarded: stats?.total_rewarded || 0,
          totalSubscribed: stats?.total_subscribed || 0,
          creditsEarned,
          freeMonthsEarned: user?.free_months_earned || 0,
        });
      }

      default:
        return res.status(400).json({ error: "Unknown action. Expected: get-code, stats" });
    }
  } catch (err: any) {
    console.error("[referral]", err.message);
    return res.status(500).json({ error: "Referral operation failed" });
  }
}

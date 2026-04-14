import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { allowed } = await checkRateLimit(auth.userId, "earnings", { max: 30, windowSeconds: 60 });
    if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

    const sql = getDb();

    // Feed post earnings (credits)
    const feedCredits = await sql`
      SELECT
        COALESCE(SUM(fu.credits_paid), 0)::int AS total_credits,
        COUNT(*)::int AS unlock_count
      FROM feed_unlocks fu
      JOIN feed_posts fp ON fp.id = fu.post_id
      WHERE fp.user_id = ${auth.userId}::uuid
        AND fu.credits_paid > 0
    `.catch(() => [{ total_credits: 0, unlock_count: 0 }]);

    // Feed post earnings (stripe / cents)
    const feedCash = await sql`
      SELECT
        COALESCE(SUM(fu.cents_paid), 0)::int AS total_cents,
        COUNT(*)::int AS unlock_count
      FROM feed_unlocks fu
      JOIN feed_posts fp ON fp.id = fu.post_id
      WHERE fp.user_id = ${auth.userId}::uuid
        AND fu.cents_paid > 0
    `.catch(() => [{ total_cents: 0, unlock_count: 0 }]);

    // Story earnings (credits)
    const storyCredits = await sql`
      SELECT
        COALESCE(SUM(su.credits_paid), 0)::int AS total_credits,
        COUNT(*)::int AS unlock_count
      FROM story_unlocks su
      JOIN stories s ON s.id = su.story_id
      WHERE s.user_id = ${auth.userId}::uuid
    `.catch(() => [{ total_credits: 0, unlock_count: 0 }]);

    // Recent transactions (last 20)
    const recent = await sql`
      (
        SELECT 'post' AS type, fu.credits_paid, fu.cents_paid, fu.unlocked_at,
               u.email AS buyer_email,
               COALESCE(p2.username, LEFT(u.email, 3) || '***') AS buyer_name
        FROM feed_unlocks fu
        JOIN feed_posts fp ON fp.id = fu.post_id
        JOIN users u ON u.id = fu.user_id
        LEFT JOIN profiles p2 ON p2.user_id = fu.user_id
        WHERE fp.user_id = ${auth.userId}::uuid
      )
      UNION ALL
      (
        SELECT 'story' AS type, su.credits_paid, 0 AS cents_paid, su.unlocked_at,
               u.email AS buyer_email,
               COALESCE(p2.username, LEFT(u.email, 3) || '***') AS buyer_name
        FROM story_unlocks su
        JOIN stories s ON s.id = su.story_id
        JOIN users u ON u.id = su.user_id
        LEFT JOIN profiles p2 ON p2.user_id = su.user_id
        WHERE s.user_id = ${auth.userId}::uuid
      )
      ORDER BY unlocked_at DESC
      LIMIT 20
    `.catch(() => []);

    const totalCreditsEarned = (feedCredits[0]?.total_credits || 0) + (storyCredits[0]?.total_credits || 0);
    const creatorShareCredits = Math.floor(totalCreditsEarned * 0.75);
    const totalCentsEarned = feedCash[0]?.total_cents || 0;
    const creatorShareCents = Math.floor(totalCentsEarned * 0.75);
    const charityCredits = Math.floor(totalCreditsEarned * 0.05);
    const charityCents = Math.floor(totalCentsEarned * 0.05);

    return res.status(200).json({
      summary: {
        totalCreditsEarned,
        creatorShareCredits,
        totalCentsEarned,
        creatorShareCents,
        charityCredits,
        charityCents,
        postUnlocks: (feedCredits[0]?.unlock_count || 0) + (feedCash[0]?.unlock_count || 0),
        storyUnlocks: storyCredits[0]?.unlock_count || 0,
      },
      recent: recent.map((r: any) => ({
        type: r.type,
        creditsPaid: r.credits_paid,
        centsPaid: r.cents_paid,
        buyerName: r.buyer_name,
        unlockedAt: r.unlocked_at,
      })),
    });
  } catch (err: any) {
    console.error("[earnings]", err.message);
    return res.status(500).json({ error: "Failed to fetch earnings" });
  }
}

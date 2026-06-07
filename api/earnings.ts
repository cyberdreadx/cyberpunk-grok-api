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

    // XRGE earnings from feed unlocks
    const feedXrge = await sql`
      SELECT
        COALESCE(SUM(fu.xrge_paid::numeric), 0) AS total_xrge,
        COUNT(*)::int AS unlock_count
      FROM feed_unlocks fu
      JOIN feed_posts fp ON fp.id = fu.post_id
      WHERE fp.user_id = ${auth.userId}::uuid
        AND fu.xrge_paid IS NOT NULL
    `.catch(() => [{ total_xrge: 0, unlock_count: 0 }]);

    // XRGE earnings from story unlocks
    const storyXrge = await sql`
      SELECT
        COALESCE(SUM(su.xrge_paid::numeric), 0) AS total_xrge,
        COUNT(*)::int AS unlock_count
      FROM story_unlocks su
      JOIN stories s ON s.id = su.story_id
      WHERE s.user_id = ${auth.userId}::uuid
        AND su.xrge_paid IS NOT NULL
    `.catch(() => [{ total_xrge: 0, unlock_count: 0 }]);

    // Recent transactions (last 20) — include XRGE
    const recent = await sql`
      (
        SELECT 'post' AS type, fu.credits_paid, fu.cents_paid, fu.unlocked_at,
               COALESCE(fu.xrge_paid, '') AS xrge_paid,
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
               COALESCE(su.xrge_paid, '') AS xrge_paid,
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
    // Get cash balance
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cash_balance_cents INT NOT NULL DEFAULT 0`.catch(() => {});
    const [userRow] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${auth.userId}::uuid`;

    // Chat earnings (creator persona chat — already folded into cash_balance_cents)
    const [chat] = await sql`
      SELECT COALESCE(SUM(creator_cents), 0)::int AS cents,
             COUNT(*) FILTER (WHERE kind = 'message')::int AS msgs,
             COUNT(*) FILTER (WHERE kind IN ('image', 'video'))::int AS media
      FROM creator_chat_earnings WHERE creator_id = ${auth.userId}::uuid
    `.catch(() => [{ cents: 0, msgs: 0, media: 0 }]);

    const totalCreditsEarned = (feedCredits[0]?.total_credits || 0) + (storyCredits[0]?.total_credits || 0);
    const creatorShareCredits = Math.floor(totalCreditsEarned * 0.75);
    const totalCentsEarned = feedCash[0]?.total_cents || 0;
    const creatorShareCents = Math.floor(totalCentsEarned * 0.75);
    const charityCredits = Math.floor(totalCreditsEarned * 0.05);
    const charityCents = Math.floor(totalCentsEarned * 0.05);

    const totalXrgeEarned = parseFloat(feedXrge[0]?.total_xrge || 0) + parseFloat(storyXrge[0]?.total_xrge || 0);
    const creatorShareXrge = parseFloat((totalXrgeEarned * 0.80).toFixed(4));
    const xrgeUnlocks = (feedXrge[0]?.unlock_count || 0) + (storyXrge[0]?.unlock_count || 0);

    return res.status(200).json({
      summary: {
        totalCreditsEarned,
        creatorShareCredits,
        totalCentsEarned,
        creatorShareCents,
        charityCredits,
        charityCents,
        cashBalanceCents: userRow?.cash_balance_cents || 0,
        chatEarningsCents: chat?.cents || 0,
        chatMessages: chat?.msgs || 0,
        chatMedia: chat?.media || 0,
        postUnlocks: (feedCredits[0]?.unlock_count || 0) + (feedCash[0]?.unlock_count || 0),
        storyUnlocks: storyCredits[0]?.unlock_count || 0,
        totalXrgeEarned,
        creatorShareXrge,
        xrgeUnlocks,
      },
      recent: recent.map((r: any) => ({
        type: r.type,
        creditsPaid: r.credits_paid,
        centsPaid: r.cents_paid,
        xrgePaid: r.xrge_paid || undefined,
        buyerName: r.buyer_name,
        unlockedAt: r.unlocked_at,
      })),
    });
  } catch (err: any) {
    console.error("[earnings]", err.message);
    return res.status(500).json({ error: "Failed to fetch earnings" });
  }
}

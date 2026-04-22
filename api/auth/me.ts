import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "../_lib/auth";
import { applyCors } from "../_lib/cors";
import { checkRateLimit } from "../_lib/ratelimit";
import { hasKarmaUnlock, KARMA_THRESHOLD } from "../_lib/karma";
import { hasPurchased } from "../_lib/purchaseGate";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    await checkRateLimit(auth.userId, "me", { max: 60, windowSeconds: 60 });

    const sql = getDb();
    // Defensive: ensure verification + karma columns exist (idempotent)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'`.catch(() => {});
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_renews_at TIMESTAMPTZ`.catch(() => {});
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS karma INTEGER NOT NULL DEFAULT 0`.catch(() => {});

    const rows = await sql`
      SELECT id, email, email_verified, sub_credits, pack_credits, subscription_tier, subscription_renews_at,
             verification_status, verification_renews_at, COALESCE(karma, 0)::int AS karma
      FROM users
      WHERE id = ${auth.userId}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = rows[0];
    const modRows = await sql`SELECT 1 FROM feed_moderators WHERE user_id = ${auth.userId} LIMIT 1`.catch(() => []);
    const isAdmin = user.email === ADMIN_EMAIL;
    const verifiedActive =
      isAdmin ||
      (user.verification_status === "verified" &&
        (!user.verification_renews_at || new Date(user.verification_renews_at) > new Date()));

    // Posting eligibility — surface both paths so the UI can render the right CTA.
    const purchased = await hasPurchased(sql, auth.userId);
    const karmaUnlock = await hasKarmaUnlock(sql, auth.userId);
    const canPostNow = isAdmin || purchased || karmaUnlock.ok;

    return res.status(200).json({
      id: user.id,
      email: user.email,
      email_verified: !!user.email_verified,
      is_admin: isAdmin,
      is_feed_mod: modRows.length > 0,
      is_verified: verifiedActive,
      verification_status: user.verification_status || "unverified",
      sub_credits: user.sub_credits,
      pack_credits: user.pack_credits,
      subscription_tier: user.subscription_tier,
      subscription_renews_at: user.subscription_renews_at,
      karma: user.karma,
      posting: {
        can_post: canPostNow,
        purchased,
        karma: user.karma,
        karma_threshold: KARMA_THRESHOLD,
        karma_unlock_ok: karmaUnlock.ok,
        email_verified: karmaUnlock.emailVerified,
        account_age_hours: Math.floor(karmaUnlock.accountAgeHours),
        min_account_age_hours: karmaUnlock.minAccountAgeHours,
      },
    });
  } catch (err: any) {
    console.error("[me]", err.message);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
}


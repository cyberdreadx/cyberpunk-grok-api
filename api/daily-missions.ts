import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";
import { awardKarma } from "./_lib/karma";
import { notify } from "./_lib/notify";
import { isSourceDisabled, FREE_CREDITS_MAINTENANCE_MESSAGE } from "./_lib/freeCredits";

const MISSIONS = ["login", "story", "reddit", "grok_subreddit", "twitter", "share"] as const;
const MISSION_CREDITS: Record<string, number> = {
  login: 3,
  story: 7,
  reddit: 10,
  grok_subreddit: 15, // r/grok — highest-converting channel, premium reward
  twitter: 10,
  share: 10,
};

// URL validators for social proof missions
const REDDIT_URL_RE = /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/(r\/[A-Za-z0-9_]+\/)?(comments|s)\/[A-Za-z0-9]+/i;
// r/grok specifically — must be in that exact subreddit (case-insensitive)
const GROK_SUBREDDIT_URL_RE = /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/r\/grok\/(comments|s)\/[A-Za-z0-9]+/i;
const TWITTER_URL_RE = /^https?:\/\/(www\.|mobile\.)?(twitter\.com|x\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+/i;
const STREAK_BONUS = 50;
const CYCLE_DAYS = 7;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "daily-missions", { max: 60, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();

  try {
    if (req.method === "GET") {
      return await getStatus(sql, auth.userId, res);
    }
    if (req.method === "POST") {
      if (await isSourceDisabled("missions")) {
        return res.status(503).json({ error: FREE_CREDITS_MAINTENANCE_MESSAGE, maintenance: true });
      }
      const { mission, url } = req.body || {};
      if (mission === "streak_bonus") {
        return await claimStreakBonus(sql, auth.userId, res);
      }
      if (!MISSIONS.includes(mission)) {
        return res.status(400).json({ error: `Invalid mission. Must be one of: ${MISSIONS.join(", ")}` });
      }
      return await claimMission(sql, auth.userId, mission, res, url);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[daily-missions]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

async function ensureProgress(sql: any, userId: string) {
  const today = new Date().toISOString().split("T")[0];

  // Get or create progress row
  let [progress] = await sql`
    INSERT INTO daily_mission_progress (user_id)
    VALUES (${userId})
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING *
  `;

  // Check if we need to advance the streak day or reset the cycle
  if (progress.last_claim_date) {
    const lastDate = new Date(progress.last_claim_date);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000);

    if (diffDays > 1) {
      // Missed a day — reset cycle
      [progress] = await sql`
        UPDATE daily_mission_progress
        SET streak_day = 1, cycle_start = ${today}, streak_bonus_claimed = false, updated_at = now()
        WHERE user_id = ${userId}
        RETURNING *
      `;
    } else if (diffDays === 1 && progress.streak_day < CYCLE_DAYS) {
      // New day — advance streak
      [progress] = await sql`
        UPDATE daily_mission_progress
        SET streak_day = streak_day + 1, updated_at = now()
        WHERE user_id = ${userId}
        RETURNING *
      `;
    } else if (diffDays >= 1 && progress.streak_day >= CYCLE_DAYS) {
      // Completed cycle, start new one
      [progress] = await sql`
        UPDATE daily_mission_progress
        SET streak_day = 1, cycle_start = ${today}, streak_bonus_claimed = false, updated_at = now()
        WHERE user_id = ${userId}
        RETURNING *
      `;
    }
  }

  return progress;
}

async function getStatus(sql: any, userId: string, res: VercelResponse) {
  const progress = await ensureProgress(sql, userId);
  const today = new Date().toISOString().split("T")[0];

  const claims = await sql`
    SELECT mission FROM daily_mission_claims
    WHERE user_id = ${userId} AND claim_date = ${today}
  `;
  const claimedToday = claims.map((c: any) => c.mission);

  // Most recent public feed post with media — used to prefill Reddit/X share URLs
  // so users post their actual generations rather than a generic landing-page link.
  let lastFeedPost: { id: string; image_url: string | null; text: string | null } | null = null;
  try {
    const [row] = await sql`
      SELECT id::text, image_url, text
      FROM feed_posts
      WHERE user_id = ${userId}::uuid AND image_url IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    `;
    if (row) lastFeedPost = row;
  } catch {}

  return res.status(200).json({
    streakDay: progress.streak_day,
    cycleStart: progress.cycle_start,
    lastClaimDate: progress.last_claim_date,
    streakBonusClaimed: progress.streak_bonus_claimed,
    totalEarned: progress.total_earned,
    claimedToday,
    missions: MISSIONS,
    missionCredits: MISSION_CREDITS,
    streakBonus: STREAK_BONUS,
    cycleDays: CYCLE_DAYS,
    lastFeedPost,
    freeCreditsDisabled: await isSourceDisabled("missions"),
    maintenanceMessage: (await isSourceDisabled("missions")) ? FREE_CREDITS_MAINTENANCE_MESSAGE : null,
  });
}

async function claimMission(sql: any, userId: string, mission: string, res: VercelResponse, url?: string) {
  const today = new Date().toISOString().split("T")[0];
  await ensureProgress(sql, userId);

  // Check if already claimed today
  const [existing] = await sql`
    SELECT id FROM daily_mission_claims
    WHERE user_id = ${userId} AND claim_date = ${today} AND mission = ${mission}
  `;
  if (existing) {
    return res.status(409).json({ error: "Already claimed today" });
  }

  // ── URL-proof missions: validate, dedupe, age-check, and notify admin ──
  const urlMissions = ["reddit", "grok_subreddit", "twitter"] as const;
  if ((urlMissions as readonly string[]).includes(mission)) {
    const trimmed = (url || "").trim();
    const platformLabel =
      mission === "twitter" ? "X" : mission === "grok_subreddit" ? "r/grok Reddit" : "Reddit";
    if (!trimmed) {
      return res.status(400).json({ error: `Please paste your ${platformLabel} post URL to claim.` });
    }
    if (trimmed.length > 500) {
      return res.status(400).json({ error: "URL too long" });
    }
    const re =
      mission === "twitter"
        ? TWITTER_URL_RE
        : mission === "grok_subreddit"
          ? GROK_SUBREDDIT_URL_RE
          : REDDIT_URL_RE;
    if (!re.test(trimmed)) {
      const hint =
        mission === "twitter"
          ? "Invalid X URL. Must look like https://x.com/username/status/123..."
          : mission === "grok_subreddit"
            ? "Must be a post in r/grok. Example: https://reddit.com/r/grok/comments/..."
            : "Invalid Reddit URL. Must look like https://reddit.com/r/.../comments/...";
      return res.status(400).json({ error: hint });
    }

    // ── r/grok strict checks: post must be ≥10min old AND have a link/image (not text-only) ──
    if (mission === "grok_subreddit") {
      const check = await verifyRedditPost(trimmed);
      if (!check.ok) {
        return res.status(400).json({ error: (check as { ok: false; error: string }).error });
      }
    }

    // Platform-wide dedup: same URL can never be reused (by anyone)
    const [dup] = await sql`SELECT id FROM daily_share_proofs WHERE url = ${trimmed} LIMIT 1`;
    if (dup) {
      return res.status(409).json({ error: "This URL has already been submitted. Share a new post." });
    }
    try {
      await sql`
        INSERT INTO daily_share_proofs (user_id, platform, url, claim_date)
        VALUES (${userId}::uuid, ${mission}, ${trimmed}, ${today}::date)
      `;
    } catch (e: any) {
      return res.status(409).json({ error: "Already submitted today" });
    }

    // ── Admin notification (fire-and-forget) so spam can be spot-checked ──
    try {
      const [admin] = await sql`SELECT id FROM users WHERE email = ${ADMIN_EMAIL} LIMIT 1`;
      if (admin?.id && admin.id !== userId) {
        const [actor] = await sql`SELECT email, COALESCE((SELECT username FROM profiles WHERE user_id = users.id), email) AS handle FROM users WHERE id = ${userId}`;
        notify({
          userId: admin.id,
          type: "system",
          title: `Social proof: ${platformLabel}`,
          body: `@${actor?.handle || "user"} claimed ${mission} — ${trimmed}`,
          actorId: userId,
          refId: trimmed,
        });
      }
    } catch (e) {
      console.error("[daily-missions] admin notify failed", e);
    }
  } else {
    // ── Server-side verification for non-URL missions ──
    const verified = await verifyMission(sql, userId, mission, today);
    if (!verified) {
      return res.status(403).json({ error: `Mission "${mission}" not completed. Do the action first, then claim.` });
    }
  }

  const creditAmount = MISSION_CREDITS[mission] || 5;

  // Insert claim
  await sql`
    INSERT INTO daily_mission_claims (user_id, claim_date, mission, credits)
    VALUES (${userId}, ${today}, ${mission}, ${creditAmount})
  `;

  // Award credits (add to pack_credits)
  await sql`
    UPDATE users SET pack_credits = pack_credits + ${creditAmount}, updated_at = now()
    WHERE id = ${userId}
  `;

  // Update progress
  await sql`
    UPDATE daily_mission_progress
    SET last_claim_date = ${today}, total_earned = total_earned + ${creditAmount}, updated_at = now()
    WHERE user_id = ${userId}
  `;

  // Karma — engagement reward for completing a mission
  await awardKarma(sql, userId, "daily_mission", `mission:${today}:${mission}`);

  return res.status(200).json({ credited: creditAmount, mission });
}

/** Verify that the user actually performed the mission action today. */
async function verifyMission(sql: any, userId: string, mission: string, today: string): Promise<boolean> {
  switch (mission) {
    case "login":
      // They're authenticated and hitting this endpoint — login verified
      return true;

    case "story": {
      // Check if user posted a story today
      const [story] = await sql`
        SELECT id FROM stories
        WHERE user_id = ${userId}::uuid AND created_at::date = ${today}::date
        LIMIT 1
      `;
      return !!story;
    }

    case "share": {
      // Check if user used the share API today (logged in usage_log with mode='share')
      const [shareLog] = await sql`
        SELECT id FROM usage_log
        WHERE user_id = ${userId}::uuid AND mode = 'share' AND created_at::date = ${today}::date
        LIMIT 1
      `;
      return !!shareLog;
    }

    default:
      return false;
  }
}

async function claimStreakBonus(sql: any, userId: string, res: VercelResponse) {
  const progress = await ensureProgress(sql, userId);

  if (progress.streak_day < CYCLE_DAYS) {
    return res.status(400).json({ error: `Must reach day ${CYCLE_DAYS} to claim streak bonus` });
  }
  if (progress.streak_bonus_claimed) {
    return res.status(409).json({ error: "Streak bonus already claimed this cycle" });
  }

  await sql`
    UPDATE users SET pack_credits = pack_credits + ${STREAK_BONUS}, updated_at = now()
    WHERE id = ${userId}
  `;

  const today = new Date().toISOString().split("T")[0];
  await sql`
    UPDATE daily_mission_progress
    SET streak_bonus_claimed = true, last_claim_date = ${today},
        total_earned = total_earned + ${STREAK_BONUS}, updated_at = now()
    WHERE user_id = ${userId}
  `;

  // Karma — completing a 7-day streak is a strong engagement signal
  await awardKarma(sql, userId, "streak_bonus", `streak_bonus:${today}:${userId}`);

  return res.status(200).json({ credited: STREAK_BONUS, mission: "streak_bonus" });
}

/**
 * Public Reddit JSON API check used to enforce r/grok mission quality:
 *  1. Post must be at least 10 minutes old (anti hit-and-delete spam)
 *  2. Post must contain media (link, image, gallery) — no text-only/title-only posts
 *
 * Reddit's `<permalink>.json` is unauthenticated and returns post metadata.
 * Returns { ok: true } on success or { ok: false, error } with a user-friendly message.
 */
async function verifyRedditPost(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Normalize → strip trailing slash, strip query, append .json
    const cleanUrl = url.split("?")[0].replace(/\/$/, "") + ".json";
    const resp = await fetch(cleanUrl, {
      headers: { "User-Agent": "GltchDailyMissionBot/1.0" },
      // Reddit can be slow — short timeout via AbortController
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      return { ok: false, error: `Couldn't read your post (Reddit returned ${resp.status}). Make sure it's public.` };
    }
    const data = await resp.json();
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) {
      return { ok: false, error: "Couldn't parse your Reddit post. Try again in a moment." };
    }
    // 1. Age check
    const ageSec = Math.floor(Date.now() / 1000) - (post.created_utc || 0);
    if (ageSec < 600) {
      const wait = Math.ceil((600 - ageSec) / 60);
      return { ok: false, error: `Post is too new — wait ~${wait} more min before claiming (anti-spam).` };
    }
    // 2. Content type — must be a link/image/gallery, not a self-post with no media
    const isSelfText = post.is_self === true;
    const hasMedia = !!(post.url_overridden_by_dest || post.preview || post.is_gallery || post.media || post.thumbnail && post.thumbnail !== "self");
    if (isSelfText && !hasMedia) {
      return { ok: false, error: "Post must include an image, video, or link — text-only posts don't count." };
    }
    return { ok: true };
  } catch (err: any) {
    console.warn("[daily-missions] verifyRedditPost failed:", err.message);
    // Soft-fail: if Reddit is down, accept the URL — better UX than blocking. Admin notify still fires.
    return { ok: true };
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest, ADMIN_EMAIL, checkBan } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";
import { awardKarma } from "./_lib/karma";
import { notify } from "./_lib/notify";
import { isSourceDisabled, FREE_CREDITS_MAINTENANCE_MESSAGE } from "./_lib/freeCredits";
import { isSubscriber, FREE_CREDITS_SUBSCRIBER_ONLY_MESSAGE } from "./_lib/subscriberGate";
import { PROMO_CREDIT_DAYS, PAID_CREDIT_DAYS } from "./_lib/credit-expiry";
import { confirmedDeletions, DELETIONS_BEFORE_BLOCK } from "./_lib/share-proof-recheck";

/*
 * The Reddit missions are retired, not paused.
 *
 * They paid 10 and 25 credits for a link nobody could read: Reddit blocks this
 * server (403 on every .json route), the old verifier soft-failed open so it
 * approved everything, and the public front-ends that might have substituted
 * managed one successful fetch in twenty attempts. 6,360 claims, 63,600 credits.
 *
 * The official API would fix it, but Reddit now gates API access behind an
 * application review, which is not worth clearing to police a daily mission.
 * Sharing is already rewarded better and unfarmably: share links carry the
 * sharer's referral code, so bringing someone who verifies and creates pays 15
 * credits, and nobody can mint that by pasting a stranger's URL.
 *
 * RETIRED_MISSIONS stay listed so old clients get a clear answer rather than
 * "Invalid mission".
 */
const MISSIONS = ["login", "story", "twitter", "share"] as const;
const RETIRED_MISSIONS = ["reddit", "grok_subreddit"] as const;
const MISSION_CREDITS: Record<string, number> = {
  login: 3,
  story: 7,
  reddit: 10,
  grok_subreddit: 25, // r/grok — highest-converting channel, premium reward
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
      const ban = await checkBan(sql, auth.userId);
      if (ban.banned) return res.status(403).json({ error: "Account suspended" });
      if (!(await isSubscriber(auth.userId))) {
        return res.status(403).json({ error: FREE_CREDITS_SUBSCRIBER_ONLY_MESSAGE, subscriberOnly: true });
      }
      if (await isSourceDisabled("missions")) {
        return res.status(503).json({ error: FREE_CREDITS_MAINTENANCE_MESSAGE, maintenance: true });
      }
      const { mission, url } = req.body || {};
      if (mission === "streak_bonus") {
        return await claimStreakBonus(sql, auth.userId, res);
      }
      if ((RETIRED_MISSIONS as readonly string[]).includes(mission)) {
        return res.status(410).json({
          error:
            "The Reddit missions have been retired — the posts couldn't be verified. " +
            "Share from the app instead: your share links carry your referral code, and you earn " +
            "15 credits when someone signs up through one and creates something.",
          code: "mission_retired",
        });
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

    /*
     * This function used to ADVANCE the streak, and it is called on every
     * status fetch and every claim — but the date it compared against,
     * last_claim_date, is only written when a mission is actually claimed. So
     * every call on a day whose last claim was "yesterday" saw diffDays === 1
     * and stepped the streak again. Four missions a day meant four streak days
     * a day; simply opening the app repeatedly did it too. A user reported
     * reaching the 7-day bonus three times in one week, and 19 of 573 live
     * streaks were ahead of their own cycle start — two of them at day 7 on the
     * day the cycle began.
     *
     * Advancing now happens exactly once per day, in the claim path below,
     * where the day is recorded in the same statement that moves the streak.
     * All that is left here is ending a cycle that is genuinely over.
     */
    if (diffDays > 1) {
      // Missed a day — the run is broken, start again from zero.
      [progress] = await sql`
        UPDATE daily_mission_progress
        SET streak_day = 0, cycle_start = ${today}, streak_bonus_claimed = false, updated_at = now()
        WHERE user_id = ${userId}
        RETURNING *
      `;
    } else if (diffDays >= 1 && progress.streak_day >= CYCLE_DAYS) {
      // Last cycle finished — a new one starts with today's first claim.
      [progress] = await sql`
        UPDATE daily_mission_progress
        SET streak_day = 0, cycle_start = ${today}, streak_bonus_claimed = false, updated_at = now()
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
    freeCreditsDisabled: (await isSourceDisabled("missions")) || !(await isSubscriber(userId)),
    subscriberOnly: !(await isSubscriber(userId)),
    maintenanceMessage: !(await isSubscriber(userId))
      ? FREE_CREDITS_SUBSCRIBER_ONLY_MESSAGE
      : (await isSourceDisabled("missions")) ? FREE_CREDITS_MAINTENANCE_MESSAGE : null,
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

    /*
     * Reddit missions are CLOSED, not merely unverified.
     *
     * verifyRedditPost() soft-fails open when Reddit does not answer, and
     * Reddit now returns 403 to this server for every request — datacenter IPs
     * are blocked — so it has been verifying nothing and approving everything.
     * Meanwhile 6,360 Reddit claims paid out 63,600 credits, and a sample of
     * what people actually submitted was other users' posts and comments
     * ("current_state_of_grok", "where_bad_rudy", r/askreddit threads).
     *
     * Paying for a claim nobody can check is just a faucet with extra steps.
     * They reopen when there are Reddit API credentials to check them with.
     */
    // ── X/Twitter: the tweet must actually link to us ──
    if (mission === "twitter") {
      /*
       * Accounts that post, collect, and delete do not get to keep doing it.
       *
       * The check below proves the post exists right now; it can say nothing
       * about tomorrow. cron-share-proof-recheck re-reads these later and
       * reverses the ones that vanished — 28% of them when it was measured,
       * with one account responsible for 10 deletions. The clawback makes each
       * round pointless; this makes the round stop.
       *
       * Two confirmed deletions, not one: deleting a post once is something an
       * honest person does, and the credits for it have already come back by
       * then.
       */
      const strikes = await confirmedDeletions(sql, userId);
      if (strikes >= DELETIONS_BEFORE_BLOCK) {
        return res.status(403).json({
          error: `This mission is closed on your account — ${strikes} of your X posts were deleted after being credited. Posts have to stay up.`,
        });
      }
    
      const check = await verifyTweetLinksToUs(trimmed);
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
        await notify({
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
  await sql`SELECT add_expiring_credits(${userId}::uuid, ${creditAmount}, 'promo', ${'mission:' + mission}, ${PROMO_CREDIT_DAYS})`;

  /*
   * Move the streak here, in the same statement that stamps the day.
   *
   * The CASE is the whole fix: a second claim on the same day finds
   * last_claim_date already equal to today and leaves streak_day alone, so the
   * count can only ever rise once per calendar day no matter how many missions
   * are claimed or how often the app is opened.
   */
  await sql`
    UPDATE daily_mission_progress
    SET streak_day = CASE
          WHEN last_claim_date = ${today}::date THEN streak_day
          WHEN last_claim_date = ${today}::date - 1 THEN LEAST(streak_day + 1, ${CYCLE_DAYS})
          ELSE 1
        END,
        cycle_start = CASE
          WHEN last_claim_date IS NULL OR last_claim_date < ${today}::date - 1 THEN ${today}::date
          ELSE cycle_start
        END,
        last_claim_date = ${today},
        total_earned = total_earned + ${creditAmount},
        updated_at = now()
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

  // Claim the flag FIRST, conditionally — the read above and the write below
  // are separate autocommitted statements, so concurrent calls all saw
  // streak_bonus_claimed = false and each granted the bonus. Whoever flips the
  // flag wins; everyone else gets the 409.
  const today = new Date().toISOString().split("T")[0];
  const claimed = await sql`
    UPDATE daily_mission_progress
    SET streak_bonus_claimed = true, last_claim_date = ${today},
        total_earned = total_earned + ${STREAK_BONUS}, updated_at = now()
    WHERE user_id = ${userId} AND streak_bonus_claimed = false
    RETURNING user_id
  ` as any[];
  if (claimed.length === 0) {
    return res.status(409).json({ error: "Streak bonus already claimed this cycle" });
  }

  await sql`SELECT add_expiring_credits(${userId}::uuid, ${STREAK_BONUS}, 'promo', 'streak_bonus', ${PROMO_CREDIT_DAYS})`;

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
const OUR_DOMAINS_RE = /(gltchrunner\.com|grokrunner\.gltch\.app|gltch\.app)/i;

/**
 * Reddit needs credentials, and here is why the obvious alternatives are not used.
 *
 * reddit.com/*.json, old.reddit.com and api.reddit.com all return 403 to this
 * server — datacenter IPs are blocked. (That is also why the previous verifier
 * verified nothing: it soft-failed open, so every Reddit claim was approved.)
 * Public front-ends were measured as a fallback on 2026-09-29 and are not fit
 * to gate credits: safereddit, redlib.catsarch, libreddit.privacydev,
 * rl.bloat.cat and redlib.perennialte.ch managed ONE successful fetch between
 * them across twenty attempts.
 *
 * The official API works from a datacenter with an app's client credentials.
 * Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (reddit.com/prefs/apps, type
 * "script") and the mission reopens on its own.
 */
export function redditApiConfigured(): boolean {
  return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

let redditToken: { value: string; expires: number } | null = null;

async function redditAccessToken(): Promise<string | null> {
  if (redditToken && redditToken.expires > Date.now() + 30_000) return redditToken.value;
  try {
    const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64");
    const r = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GltchDailyMissionBot/1.0",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!d.access_token) return null;
    redditToken = { value: d.access_token, expires: Date.now() + (d.expires_in ?? 3600) * 1000 };
    return redditToken.value;
  } catch {
    return null;
  }
}

/**
 * Does this Reddit post actually link to us, and is it old enough to not be a
 * post-and-delete? Fails CLOSED — an unreadable post is not a paid one.
 */
async function verifyRedditLinksToUs(
  url: string,
  requireGrokSub: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const RETRY = "Couldn't read that post — make sure it's public, then try again in a minute.";
  const token = await redditAccessToken();
  if (!token) return { ok: false, error: RETRY };
  try {
    const clean = url.split("?")[0].replace(/\/$/, "").replace("www.reddit.com", "oauth.reddit.com")
      .replace("old.reddit.com", "oauth.reddit.com").replace("new.reddit.com", "oauth.reddit.com") + ".json";
    const r = await fetch(clean, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "GltchDailyMissionBot/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { ok: false, error: RETRY };
    const data = await r.json();
    const post = (data as any)?.[0]?.data?.children?.[0]?.data;
    if (!post) return { ok: false, error: RETRY };

    if (requireGrokSub && String(post.subreddit || "").toLowerCase() !== "grok") {
      return { ok: false, error: "That post isn't in r/grok." };
    }
    const ageSec = Math.floor(Date.now() / 1000) - (post.created_utc || 0);
    if (ageSec < 600) {
      return { ok: false, error: `Post is too new — wait ~${Math.ceil((600 - ageSec) / 60)} more min before claiming.` };
    }
    // The link can be the post's destination, its title, or its body.
    const haystack = [post.url_overridden_by_dest, post.url, post.title, post.selftext]
      .filter(Boolean).join(" ");
    if (!OUR_DOMAINS_RE.test(haystack)) {
      return {
        ok: false,
        error: "That post doesn't link to GLTCH Runner. Share one of your creations — the link from the app counts.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: RETRY };
  }
}

/**
 * Does this tweet actually link to us?
 *
 * publish.twitter.com/oembed returns a public tweet's HTML without auth. Links
 * inside are t.co-shortened, so each is resolved to its destination before
 * looking for our domains.
 *
 * Fails CLOSED on purpose. The Reddit verifier next door fails open, which is
 * how 63,600 credits went out for unchecked links; if we cannot see the tweet,
 * we do not pay for it. A sample of 150 recent claims found 81 that linked
 * somewhere else entirely and 5 that linked to us.
 */
async function verifyTweetLinksToUs(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const TOO_SOON = "Couldn't read that post — make sure it's public, then try again in a minute.";
  try {
    const resp = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`,
      { redirect: "follow", signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) return { ok: false, error: TOO_SOON };
    const data = (await resp.json()) as { html?: string };
    const html = String(data?.html || "");
    if (OUR_DOMAINS_RE.test(html)) return { ok: true };

    for (const short of [...html.matchAll(/https:\/\/t\.co\/[A-Za-z0-9]+/g)].map((m) => m[0]).slice(0, 4)) {
      try {
        const r = await fetch(short, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
        if (OUR_DOMAINS_RE.test(r.url || "")) return { ok: true };
      } catch { /* one dead shortlink should not decide the claim */ }
    }
    return {
      ok: false,
      error: "That post doesn't link to GLTCH Runner. Share one of your creations — the link from the app counts.",
    };
  } catch {
    return { ok: false, error: TOO_SOON };
  }
}

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

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

const MISSIONS = ["login", "story", "reddit", "share"] as const;
const MISSION_CREDITS: Record<string, number> = {
  login: 3,
  story: 7,
  reddit: 10,
  share: 10,
};
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
      const { mission } = req.body || {};
      if (mission === "streak_bonus") {
        return await claimStreakBonus(sql, auth.userId, res);
      }
      if (!MISSIONS.includes(mission)) {
        return res.status(400).json({ error: `Invalid mission. Must be one of: ${MISSIONS.join(", ")}` });
      }
      return await claimMission(sql, auth.userId, mission, res);
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
  });
}

async function claimMission(sql: any, userId: string, mission: string, res: VercelResponse) {
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

  return res.status(200).json({ credited: creditAmount, mission });
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

  return res.status(200).json({ credited: STREAK_BONUS, mission: "streak_bonus" });
}

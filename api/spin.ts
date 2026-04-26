/**
 * /api/spin – Spin-the-wheel endpoint (Temu-style gamified).
 *
 * GET  → returns spin state (free spin available, last spin time, streak)
 * POST → spins the wheel. { paid?: boolean }
 *
 * Free spin: 1 per 24h.
 * Paid spin: costs 10 pack_credits.
 *
 * Streak: consecutive daily free spins boost the minimum prize.
 *   Day 1: no bonus (min 1)
 *   Day 2: min 2
 *   Day 3-4: min 3
 *   Day 5-6: min 5
 *   Day 7+: min 5 + higher jackpot odds
 *
 * Streak resets if the user misses a 48h window from last free spin.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";
import { freeCreditsDisabled, FREE_CREDITS_MAINTENANCE_MESSAGE } from "./_lib/freeCredits";

/* ── Prize table ─────────────────────────────────────────────── */

interface Prize {
  id: string;
  label: string;
  credits: number;
  /** Weight out of total — higher = more common */
  weight: number;
  /** Visual colour for the wheel segment */
  color: string;
}

const PRIZES: Prize[] = [
  { id: "c1a",  label: "1 Credit",    credits: 1,   weight: 350, color: "#1a2a44" },
  { id: "c2a",  label: "2 Credits",   credits: 2,   weight: 300, color: "#0d2847" },
  { id: "c1b",  label: "1 Credit",    credits: 1,   weight: 350, color: "#162d50" },
  { id: "c3",   label: "3 Credits",   credits: 3,   weight: 200, color: "#1a2a44" },
  { id: "c1c",  label: "1 Credit",    credits: 1,   weight: 350, color: "#0d2847" },
  { id: "c5",   label: "5 Credits",   credits: 5,   weight: 100, color: "#162d50" },
  { id: "c2b",  label: "2 Credits",   credits: 2,   weight: 250, color: "#1a2a44" },
  { id: "c10",  label: "10 Credits",  credits: 10,  weight: 25,  color: "#0d2847" },
  { id: "c1d",  label: "1 Credit",    credits: 1,   weight: 350, color: "#162d50" },
  { id: "c3b",  label: "3 Credits",   credits: 3,   weight: 150, color: "#1a2a44" },
  { id: "c2c",  label: "2 Credits",   credits: 2,   weight: 250, color: "#0d2847" },
  { id: "c25",  label: "25 Credits",  credits: 25,  weight: 3,   color: "#0f1d33" },
];

/** Get minimum credits based on streak */
function getStreakMinimum(streak: number): number {
  if (streak >= 5) return 5;
  if (streak >= 3) return 3;
  if (streak >= 2) return 2;
  return 1;
}

/** Get bonus weight boost for jackpot at high streaks */
function getStreakWeightBoost(streak: number): number {
  // At day 7+ give slight boost to higher prizes
  if (streak >= 7) return 3;
  if (streak >= 5) return 2;
  return 1;
}

function pickPrize(minCredits: number, boostFactor: number): Prize {
  // Filter to only prizes >= minimum
  const eligible = PRIZES.filter(p => p.credits >= minCredits);
  if (eligible.length === 0) return PRIZES[PRIZES.length - 1]; // fallback to highest

  // Apply boost to higher-value prizes
  const boosted = eligible.map(p => ({
    ...p,
    weight: p.credits >= 10 ? p.weight * boostFactor : p.weight,
  }));

  const totalWeight = boosted.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * totalWeight;
  for (const p of boosted) {
    r -= p.weight;
    if (r <= 0) return PRIZES.find(op => op.id === p.id)!;
  }
  return eligible[0];
}

const PAID_SPIN_COST = 10;
const FREE_SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const STREAK_BREAK_MS = 48 * 60 * 60 * 1000; // 48 hours — miss this window and streak resets

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { allowed } = await checkRateLimit(auth.userId, "spin", { max: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: "Rate limit reached" });

  const sql = getDb();

  /* ── GET: spin state ──────────────────────────────────────── */
  if (req.method === "GET") {
    const [user] = await sql`
      SELECT last_free_spin, COALESCE(spin_streak, 0) as spin_streak FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });

    const lastSpin = user.last_free_spin ? new Date(user.last_free_spin).getTime() : 0;
    const freeAvailable = Date.now() - lastSpin >= FREE_SPIN_COOLDOWN_MS;
    const nextFreeAt = freeAvailable ? null : new Date(lastSpin + FREE_SPIN_COOLDOWN_MS).toISOString();

    // Check if streak would be broken
    const currentStreak = (lastSpin > 0 && Date.now() - lastSpin > STREAK_BREAK_MS) ? 0 : (user.spin_streak || 0);
    const minPrize = getStreakMinimum(currentStreak + (freeAvailable ? 1 : 0));

    const maintenance = freeCreditsDisabled();
    return res.status(200).json({
      freeAvailable: maintenance ? false : freeAvailable,
      nextFreeAt,
      paidSpinCost: PAID_SPIN_COST,
      streak: currentStreak,
      nextMinPrize: minPrize,
      prizes: PRIZES.map(p => ({ id: p.id, label: p.label, color: p.color })),
      freeCreditsDisabled: maintenance,
      maintenanceMessage: maintenance ? FREE_CREDITS_MAINTENANCE_MESSAGE : null,
    });
  }

  /* ── POST: spin ───────────────────────────────────────────── */
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { paid } = req.body || {};

  const [user] = await sql`
    SELECT daily_credits, sub_credits, pack_credits, last_free_spin, COALESCE(spin_streak, 0) as spin_streak
    FROM users WHERE id = ${auth.userId}
  `;
  if (!user) return res.status(404).json({ error: "User not found" });

  const lastSpin = user.last_free_spin ? new Date(user.last_free_spin).getTime() : 0;
  let streak = user.spin_streak || 0;

  if (paid) {
    const total = (user.daily_credits || 0) + (user.sub_credits || 0) + (user.pack_credits || 0);
    if (total < PAID_SPIN_COST) {
      return res.status(400).json({ error: "Not enough credits for a paid spin" });
    }

    let remaining = PAID_SPIN_COST;
    const fromDaily = Math.min(user.daily_credits || 0, remaining);
    remaining -= fromDaily;
    const fromSub = Math.min(user.sub_credits || 0, remaining);
    remaining -= fromSub;
    const fromPack = remaining;

    await sql`
      UPDATE users SET
        daily_credits  = daily_credits  - ${fromDaily},
        sub_credits    = sub_credits    - ${fromSub},
        pack_credits   = pack_credits   - ${fromPack},
        updated_at     = now()
      WHERE id = ${auth.userId}
    `;
    // Paid spins use current streak bonus but don't advance streak
  } else {
    if (Date.now() - lastSpin < FREE_SPIN_COOLDOWN_MS) {
      return res.status(400).json({
        error: "Free spin not available yet",
        nextFreeAt: new Date(lastSpin + FREE_SPIN_COOLDOWN_MS).toISOString(),
      });
    }

    // Update streak: if within 48h window, increment; otherwise reset to 1
    if (lastSpin > 0 && Date.now() - lastSpin <= STREAK_BREAK_MS) {
      streak += 1;
    } else {
      streak = 1;
    }

    await sql`
      UPDATE users SET 
        last_free_spin = now(), 
        spin_streak = ${streak},
        updated_at = now()
      WHERE id = ${auth.userId}
    `;
  }

  const minCredits = getStreakMinimum(streak);
  const boostFactor = getStreakWeightBoost(streak);
  const prize = pickPrize(minCredits, boostFactor);

  await sql`
    UPDATE users SET
      pack_credits = pack_credits + ${prize.credits},
      updated_at   = now()
    WHERE id = ${auth.userId}
  `;

  return res.status(200).json({
    prize: { id: prize.id, label: prize.label, credits: prize.credits },
    streak,
    minPrize: minCredits,
  });
}

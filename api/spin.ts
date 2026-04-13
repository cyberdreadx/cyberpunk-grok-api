/**
 * /api/spin – Spin-the-wheel endpoint.
 *
 * GET  → returns spin state (free spin available, last spin time)
 * POST → spins the wheel. { paid?: boolean }
 *
 * Free spin: 1 per 24h.
 * Paid spin: costs 25 pack_credits (deducted before spin).
 *
 * Prize weights are heavily skewed toward low values.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getUserFromRequest } from "./_lib/auth";
import { checkRateLimit } from "./_lib/ratelimit";

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
  { id: "c5",   label: "5 Credits",       credits: 5,   weight: 400, color: "#1e3a5f" },
  { id: "c10",  label: "10 Credits",      credits: 10,  weight: 250, color: "#0d2847" },
  { id: "c5b",  label: "5 Credits",       credits: 5,   weight: 400, color: "#162d50" },
  { id: "c20",  label: "20 Credits",      credits: 20,  weight: 80,  color: "#1e3a5f" },
  { id: "c5c",  label: "5 Credits",       credits: 5,   weight: 350, color: "#0d2847" },
  { id: "c30",  label: "30 Credits",      credits: 30,  weight: 30,  color: "#162d50" },
  { id: "c10b", label: "10 Credits",      credits: 10,  weight: 200, color: "#1e3a5f" },
  { id: "c50",  label: "50 Credits",      credits: 50,  weight: 8,   color: "#0d2847" },
  { id: "c5d",  label: "5 Credits",       credits: 5,   weight: 350, color: "#162d50" },
  { id: "c100", label: "100 Credits",     credits: 100, weight: 2,   color: "#1e3a5f" },
  { id: "c10c", label: "10 Credits",      credits: 10,  weight: 200, color: "#0d2847" },
  { id: "c300", label: "300 Credits",     credits: 300, weight: 1,   color: "#0f1d33" },
];

const TOTAL_WEIGHT = PRIZES.reduce((s, p) => s + p.weight, 0);

function pickPrize(): Prize {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const p of PRIZES) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return PRIZES[0]; // fallback
}

const PAID_SPIN_COST = 25;
const FREE_SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

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
      SELECT last_free_spin FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });

    const lastSpin = user.last_free_spin ? new Date(user.last_free_spin).getTime() : 0;
    const freeAvailable = Date.now() - lastSpin >= FREE_SPIN_COOLDOWN_MS;
    const nextFreeAt = freeAvailable ? null : new Date(lastSpin + FREE_SPIN_COOLDOWN_MS).toISOString();

    return res.status(200).json({
      freeAvailable,
      nextFreeAt,
      paidSpinCost: PAID_SPIN_COST,
      prizes: PRIZES.map(p => ({ id: p.id, label: p.label, color: p.color })),
    });
  }

  /* ── POST: spin ───────────────────────────────────────────── */
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { paid } = req.body || {};

  const [user] = await sql`
    SELECT daily_credits, sub_credits, pack_credits, last_free_spin
    FROM users WHERE id = ${auth.userId}
  `;
  if (!user) return res.status(404).json({ error: "User not found" });

  if (paid) {
    // Deduct 25 credits: daily → sub → pack
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
  } else {
    // Free spin — check cooldown
    const lastSpin = user.last_free_spin ? new Date(user.last_free_spin).getTime() : 0;
    if (Date.now() - lastSpin < FREE_SPIN_COOLDOWN_MS) {
      return res.status(400).json({
        error: "Free spin not available yet",
        nextFreeAt: new Date(lastSpin + FREE_SPIN_COOLDOWN_MS).toISOString(),
      });
    }

    // Mark free spin used
    await sql`
      UPDATE users SET last_free_spin = now(), updated_at = now()
      WHERE id = ${auth.userId}
    `;
  }

  // Pick prize & award credits
  const prize = pickPrize();

  await sql`
    UPDATE users SET
      pack_credits = pack_credits + ${prize.credits},
      updated_at   = now()
    WHERE id = ${auth.userId}
  `;

  return res.status(200).json({
    prize: { id: prize.id, label: prize.label, credits: prize.credits },
  });
}

/**
 * /api/cron-ambassador-release — mature held commissions into withdrawable cash.
 *
 * Commission is booked the moment a referred customer pays, but it isn't spendable
 * yet: it sits `pending` for the ambassador's hold window (30 days by default)
 * so a refund or chargeback can reverse it before any money leaves. This job is
 * what actually moves matured rows into users.cash_balance_cents, where the
 * existing payout rails can withdraw them.
 *
 * Runs daily. The hold window is measured in days, so anything more frequent
 * just re-asks a question whose answer changes once a day.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { requireCronAuth } from "./_lib/cron-auth";
import { releaseMaturedCommissions } from "./_lib/ambassador";
import { sendAmbassadorCommissionEmail } from "./_lib/email";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronAuth(req, res)) return;

  try {
    const sql = getDb();

    // Batched so a large backlog can't blow the request timeout; the loop
    // drains it across passes and stops as soon as a pass comes up empty.
    let released = 0;
    let releasedCents = 0;
    let voided = 0;
    // Merged across passes so someone whose commissions straddle a batch
    // boundary gets one email, not two.
    const perUser = new Map<string, { cents: number; count: number }>();

    for (let pass = 0; pass < 10; pass++) {
      const r = await releaseMaturedCommissions(sql, 500);
      released += r.released;
      releasedCents += r.releasedCents;
      voided += r.voided;
      for (const rec of r.recipients) {
        const prev = perUser.get(rec.userId) ?? { cents: 0, count: 0 };
        perUser.set(rec.userId, { cents: prev.cents + rec.cents, count: prev.count + rec.count });
      }
      if (r.released + r.voided === 0) break;
    }

    // Tell each ambassador their money cleared. Sent after all passes so the
    // balance quoted is final, and settled rather than fired in parallel so a
    // big release night doesn't burst the mail provider's rate limit.
    let emailed = 0;
    for (const [userId, agg] of perUser) {
      try {
        const [u] = await sql`
          SELECT email, email_verified, COALESCE(cash_balance_cents, 0)::int AS cash
          FROM users WHERE id = ${userId}::uuid
        `;
        if (!u?.email || !u.email_verified) continue;
        await sendAmbassadorCommissionEmail(u.email, {
          releasedCents: agg.cents,
          count: agg.count,
          withdrawableCents: u.cash,
        });
        emailed++;
      } catch (e: any) {
        console.error("[cron-ambassador-release] email failed:", e?.message);
      }
    }

    if (released || voided) {
      console.log(
        `[cron-ambassador-release] released ${released} commissions ` +
          `($${(releasedCents / 100).toFixed(2)}) to ${perUser.size} ambassadors, ` +
          `voided ${voided}, emailed ${emailed}`,
      );
    }
    return res.status(200).json({ ok: true, released, releasedCents, voided, emailed });
  } catch (err: any) {
    console.error("[cron-ambassador-release]", err?.message);
    return res.status(500).json({ ok: false, error: "release failed" });
  }
}

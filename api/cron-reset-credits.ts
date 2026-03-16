/**
 * /api/cron-reset-credits — Daily cron to reset sub_credits for yearly subscribers.
 *
 * Yearly plans only fire Stripe's invoice.paid once per year, so credits
 * aren't automatically refreshed monthly. This cron checks for yearly
 * subscribers whose subscription_renews_at has passed and resets their
 * sub_credits, then bumps the renewal date forward by 1 month.
 *
 * Secured via CRON_SECRET — Vercel sends this automatically for cron jobs.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";

const YEARLY_TIER_CREDITS: Record<string, number> = {
  "basic-yearly": 150,
  "premium-yearly": 500,
  "pro-yearly": 1200,
  "elite-yearly": 5000,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const sql = getDb();

    // Find yearly subscribers whose renewal date has passed
    const dueUsers = await sql`
      SELECT id, subscription_tier, subscription_renews_at
      FROM users
      WHERE subscription_tier LIKE '%-yearly'
        AND subscription_renews_at IS NOT NULL
        AND subscription_renews_at <= now()
        AND subscription_cancel_at IS NULL
    `;

    let resetCount = 0;

    for (const user of dueUsers) {
      const credits = YEARLY_TIER_CREDITS[user.subscription_tier];
      if (!credits) {
        console.warn(`[cron] Unknown yearly tier: ${user.subscription_tier} for user ${user.id}`);
        continue;
      }

      // Reset credits and bump renewal date forward by 1 month
      const nextRenewal = new Date(user.subscription_renews_at);
      nextRenewal.setMonth(nextRenewal.getMonth() + 1);

      await sql`
        UPDATE users
        SET sub_credits = ${credits},
            subscription_renews_at = ${nextRenewal.toISOString()}::timestamptz,
            updated_at = now()
        WHERE id = ${user.id}
      `;

      await sql`
        INSERT INTO transactions (user_id, credits, amount_cents, stripe_session_id, package, type, payment_method)
        VALUES (${user.id}::uuid, ${credits}, 0, ${'cron-reset-' + new Date().toISOString().slice(0, 10)}, ${user.subscription_tier}, 'subscription', 'cron')
      `.catch(() => {});

      console.log(`[cron] Reset ${credits} sub_credits for user ${user.id} (${user.subscription_tier}), next renewal: ${nextRenewal.toISOString()}`);
      resetCount++;
    }

    return res.status(200).json({
      success: true,
      checked: dueUsers.length,
      reset: resetCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron-reset-credits]", err.message);
    return res.status(500).json({ error: "Cron failed" });
  }
}

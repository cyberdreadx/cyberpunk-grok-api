/**
 * /api/cron-reset-daily — Reset daily_credits to 10 for all verified users
 * and send a "credits refilled" email notification.
 *
 * Runs at midnight UTC via Vercel Cron. No rollover — overwrites to exactly 10.
 * Secured via CRON_SECRET Bearer token (same pattern as cron-reset-credits).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import { getResend, getFromAddress, buildDailyCreditsHtml } from "./_lib/email";

const DAILY_AMOUNT = 10;
const BATCH_SIZE = 100; // Resend batch limit

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const sql = getDb();

    // 1. Reset credits
    const result = await sql`
      UPDATE users
      SET daily_credits = ${DAILY_AMOUNT},
          daily_credits_reset_at = now(),
          updated_at = now()
      WHERE email_verified = true
    `;

    const resetCount = result.count ?? 0;
    console.log(`[cron-reset-daily] Reset ${resetCount} users to ${DAILY_AMOUNT} daily credits`);

    // 2. Send email notifications in batches
    let emailsSent = 0;
    let emailsFailed = 0;

    try {
      const users = await sql`
        SELECT email FROM users WHERE email_verified = true
      `;

      if (users.length > 0) {
        const resend = getResend();
        const fromAddress = getFromAddress();
        const html = buildDailyCreditsHtml(DAILY_AMOUNT);

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
          const batch = users.slice(i, i + BATCH_SIZE);
          const emails = batch.map((u: any) => ({
            from: `Grok Runner <${fromAddress}>`,
            to: [u.email],
            subject: `Your ${DAILY_AMOUNT} daily credits are ready`,
            html,
          }));

          try {
            await resend.batch.send(emails);
            emailsSent += batch.length;
          } catch (batchErr: any) {
            console.error(`[cron-reset-daily] Batch ${i / BATCH_SIZE + 1} failed:`, batchErr.message);
            emailsFailed += batch.length;
          }
        }
      }
    } catch (emailErr: any) {
      console.error("[cron-reset-daily] Email notification error:", emailErr.message);
    }

    console.log(`[cron-reset-daily] Emails: ${emailsSent} sent, ${emailsFailed} failed`);

    return res.status(200).json({
      success: true,
      reset: resetCount,
      dailyAmount: DAILY_AMOUNT,
      emailsSent,
      emailsFailed,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron-reset-daily]", err.message);
    return res.status(500).json({ error: "Daily credit reset failed" });
  }
}

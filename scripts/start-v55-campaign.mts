/**
 * Start the v5.5 announcement campaign.
 *
 * Writes the active job to app_config; the every-two-minutes cron picks it up
 * and sends in batches of 50 (up to 5 batches per run, so ~250 per tick).
 *
 * Refuses to clobber a campaign that is still running, and clears any stale
 * cancel row for this campaign first — a leftover cancel would make the very
 * first batch mark the job cancelled and send nothing.
 *
 * To stop mid-run: INSERT INTO announcement_cancels (campaign) VALUES
 * ('announcement_v55') — the next batch sees it and stops. Mail already
 * accepted by Resend cannot be recalled.
 */
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import {
  readActiveCampaign,
  saveCampaignJob,
  getCampaignRemaining,
  getDefaultSubject,
} from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";

const CAMPAIGN = "announcement_v55";
const sql = getDb();

const running = await readActiveCampaign(sql);
if (running && running.campaign !== CAMPAIGN) {
  console.error(`refusing to start: "${running.campaign}" is still active`);
  process.exit(1);
}

const stale = await sql`DELETE FROM announcement_cancels WHERE campaign = ${CAMPAIGN} RETURNING campaign`;
if (stale.length) console.log(`cleared a stale cancel row for ${CAMPAIGN}`);

const alreadySent = await sql`
  SELECT count(*) AS n FROM email_log WHERE email_type = ${CAMPAIGN} AND status = 'sent'`;
const remaining = await getCampaignRemaining(sql, CAMPAIGN);
const subject = getDefaultSubject(CAMPAIGN);

console.log(`campaign:  ${CAMPAIGN}`);
console.log(`subject:   ${subject}`);
console.log(`already sent: ${alreadySent[0].n}`);
console.log(`to send:      ${remaining}`);

await saveCampaignJob(sql, {
  campaign: CAMPAIGN,
  subject,
  html: null,               // built per-recipient so each gets its own unsub token
  status: "active",
  startedAt: new Date().toISOString(),
  batchSize: 50,
  totalSent: 0,
  totalFailed: 0,
});

const check = await readActiveCampaign(sql);
console.log(`\nstatus: ${check?.status ?? "NOT ACTIVE"} — cron picks it up within 2 minutes`);
process.exit(check?.status === "active" ? 0 : 1);

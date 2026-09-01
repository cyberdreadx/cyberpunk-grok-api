/**
 * Progress readout for the v5.5 campaign.
 *
 * Watches for the two things that have gone wrong with campaigns before:
 * duplicate delivery (the "20 copies" bug, where every recipient logged as
 * failed so the same oldest-N were re-selected each tick) and a stalled queue.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { readActiveCampaign, getCampaignRemaining } from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";

const CAMPAIGN = "announcement_v55";
const sql = getDb();

const job = await readActiveCampaign(sql);
const [tally] = await sql`
  SELECT count(*) FILTER (WHERE status = 'sent')   AS sent,
         count(*) FILTER (WHERE status <> 'sent')  AS failed,
         count(DISTINCT recipient)                 AS distinct_recipients,
         count(*)                                  AS rows,
         min(created_at) AS started, max(created_at) AS latest
  FROM email_log WHERE email_type = ${CAMPAIGN}`;

const remaining = await getCampaignRemaining(sql, CAMPAIGN);
const sent = Number(tally.sent);
const total = sent + remaining;
const pct = total ? ((sent / total) * 100).toFixed(1) : "0.0";

console.log(`status:     ${job?.status ?? "not active (complete or cancelled)"}`);
console.log(`sent:       ${sent} / ${total}  (${pct}%)`);
console.log(`failed:     ${tally.failed}`);
console.log(`remaining:  ${remaining}`);
if (tally.started) {
  const mins = (Date.now() - new Date(tally.latest).getTime()) / 60000;
  console.log(`started:    ${String(tally.started).slice(0, 21)}`);
  console.log(`last send:  ${mins.toFixed(1)} min ago`);
}

// The duplicate-delivery guard: one row per recipient, always.
const dupes = Number(tally.rows) - Number(tally.distinct_recipients);
console.log(`\nduplicate sends: ${dupes === 0 ? "none" : `${dupes} ← INVESTIGATE`}`);

if (Number(tally.failed) > 0) {
  const why = await sql`
    SELECT error, count(*) AS n FROM email_log
    WHERE email_type = ${CAMPAIGN} AND status <> 'sent'
    GROUP BY error ORDER BY n DESC LIMIT 3`;
  console.log("failure reasons:");
  for (const r of why) console.log(`  ${r.n}× ${String(r.error || "(none)").slice(0, 90)}`);
}

process.exit(0);

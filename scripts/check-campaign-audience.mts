/**
 * Who would a v5.5 announcement actually reach, and who has asked not to be?
 *
 * getCampaignRecipients() selects every verified user and does not consult
 * notification_prefs at all — the opt-out table migration 052 added precisely
 * because CAN-SPAM requires a working one.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

const [a] = await sql`SELECT count(*) AS n FROM users WHERE email_verified = true`;
console.log(`verified users (what the campaign query selects): ${a.n}`);

const [b] = await sql`
  SELECT count(*) AS n FROM users u
  JOIN notification_prefs p ON p.user_id = u.id
  WHERE u.email_verified = true AND p.email_enabled = false`;
console.log(`  …of whom have email_enabled = false: ${b.n}  ← would be mailed anyway`);

const [c] = await sql`
  SELECT count(*) AS n FROM users u
  WHERE u.email_verified = true
    AND u.email NOT LIKE '%@example.test'
    AND u.email NOT LIKE '%.test'`;
console.log(`  …excluding .test addresses: ${c.n}`);

const prior = await sql`
  SELECT email_type, count(*) FILTER (WHERE status = 'sent') AS sent,
         count(*) FILTER (WHERE status <> 'sent') AS failed,
         max(created_at) AS last
  FROM email_log WHERE email_type LIKE 'announcement%'
  GROUP BY email_type ORDER BY max(created_at) DESC LIMIT 8`;
console.log("\n── past campaigns ──");
for (const r of prior) {
  console.log(`  ${String(r.email_type).padEnd(26)} sent ${String(r.sent).padStart(6)}  failed ${String(r.failed).padStart(4)}  last ${String(r.last).slice(0, 16)}`);
}

const [active] = await sql`
  SELECT value FROM app_config WHERE key = 'active_email_campaign'`;
console.log(`\nactive campaign right now: ${active ? JSON.stringify(active.value).slice(0, 160) : "none"}`);

process.exit(0);

/**
 * What a campaign actually did: delivered, bounced, complained, opened, clicked,
 * and which links earned the clicks.
 *
 * Reads email_events (migration 068), which only fills once the Resend webhook
 * is configured — before that, sends are all this can show.
 *
 *   node --env-file=.env --import tsx scripts/campaign-engagement.mts [campaign]
 */
process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const only = process.argv[2] ?? null;
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");

const campaigns = (await sql`
  SELECT email_type, COUNT(*)::int sent, MIN(created_at) started, MAX(created_at) finished
  FROM email_log
  WHERE status = 'sent' AND (${only}::text IS NULL OR email_type = ${only})
  GROUP BY email_type
  HAVING COUNT(*) >= 50
  ORDER BY MAX(created_at) DESC
  LIMIT 10`) as any[];

for (const c of campaigns) {
  const ev = (await sql`
    SELECT event, COUNT(*)::int n, COUNT(DISTINCT lower(recipient))::int people
    FROM email_events WHERE email_type = ${c.email_type} GROUP BY event`) as any[];
  const get = (e: string) => ev.find((r) => r.event === e) ?? { n: 0, people: 0 };

  console.log(`\n${c.email_type}`);
  console.log(`  sent        ${c.sent}   (${new Date(c.started).toISOString().slice(0, 16).replace("T", " ")} → ${new Date(c.finished).toISOString().slice(0, 16).replace("T", " ")} UTC)`);
  if (ev.length === 0) { console.log("  no events recorded (webhook not configured when this was sent)"); continue; }
  console.log(`  delivered   ${get("delivered").n}  ${pct(get("delivered").n, c.sent)}`);
  console.log(`  opened      ${get("opened").people} people  ${pct(get("opened").people, c.sent)}   (Apple Mail inflates this)`);
  console.log(`  clicked     ${get("clicked").people} people  ${pct(get("clicked").people, c.sent)}`);
  console.log(`  bounced     ${get("bounced").n}  ${pct(get("bounced").n, c.sent)}`);
  console.log(`  complained  ${get("complained").n}  ${pct(get("complained").n, c.sent)}`);

  const links = (await sql`
    SELECT link, COUNT(DISTINCT lower(recipient))::int people
    FROM email_events WHERE email_type = ${c.email_type} AND event = 'clicked' AND link IS NOT NULL
    GROUP BY link ORDER BY 2 DESC LIMIT 5`) as any[];
  for (const l of links) console.log(`    ${String(l.people).padStart(5)} → ${l.link}`);
}

const [{ n: sup }] = (await sql`SELECT COUNT(*)::int n FROM email_suppressions`) as any[];
console.log(`\nsuppressed addresses (never mailed again): ${sup}`);

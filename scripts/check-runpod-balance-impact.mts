/**
 * RunPod is returning 402 "Insufficient Balance" on job submit — for real
 * users, not just this session's tests. Serverless keeps warm workers running
 * on an empty account but refuses to start new ones, so the failures look
 * intermittent right up until the last worker scales down.
 *
 * This measures how long it has been happening and who it has hit.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

const byHour = await sql`
  SELECT date_trunc('hour', created_at) AS hour,
         count(*) FILTER (WHERE mode LIKE '%refunded%') AS refunded,
         count(*) FILTER (WHERE mode NOT LIKE '%refunded%') AS ok
  FROM usage_log
  WHERE mode LIKE 'comfy-%' AND created_at > now() - interval '12 hours'
  GROUP BY 1 ORDER BY 1`;

console.log("── last 12 hours ──");
console.log("  hour (UTC)         ok   refunded   fail%");
for (const r of byHour) {
  const ok = Number(r.ok), ref = Number(r.refunded);
  const pct = ok + ref ? ((ref / (ok + ref)) * 100).toFixed(1) : "0.0";
  const bar = "█".repeat(Math.min(30, Math.round(ref)));
  console.log(`  ${String(r.hour).slice(0, 16)}  ${String(ok).padStart(4)}   ${String(ref).padStart(6)}   ${pct.padStart(5)}%  ${bar}`);
}

const recent = await sql`
  SELECT count(*) AS n, count(DISTINCT user_id) AS users
  FROM usage_log
  WHERE mode LIKE '%refunded%' AND created_at > now() - interval '3 hours'`;
console.log(`\nrefunds in the last 3 hours: ${recent[0].n} across ${recent[0].users} users`);

const [today, yesterday] = await Promise.all([
  sql`SELECT count(*) AS n FROM usage_log
      WHERE mode LIKE 'comfy-%' AND mode NOT LIKE '%refunded%'
        AND created_at > now() - interval '3 hours'`,
  sql`SELECT count(*) AS n FROM usage_log
      WHERE mode LIKE 'comfy-%' AND mode NOT LIKE '%refunded%'
        AND created_at BETWEEN now() - interval '27 hours' AND now() - interval '24 hours'`,
]);
console.log(`successful jobs, last 3h: ${today[0].n}  ·  same window yesterday: ${yesterday[0].n}`);

process.exit(0);

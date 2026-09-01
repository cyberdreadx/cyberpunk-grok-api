/**
 * How is LTX actually doing in production?
 *
 * Before swapping the engine, it is worth knowing whether the problem is
 * failures, speed, cost, or output quality — those point at different fixes,
 * and only one of them is solved by a different checkpoint.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

console.log("── video engines side by side, last 90 days ──");
const rows = await sql`
  SELECT
    regexp_replace(mode, '^comfy-|-refunded.*$', '', 'g') AS engine,
    count(*) FILTER (WHERE mode NOT LIKE '%refunded%')  AS ok,
    count(*) FILTER (WHERE mode LIKE '%refunded%')      AS refunded,
    count(DISTINCT user_id)                              AS users,
    round(avg(execution_time_ms) FILTER (WHERE mode NOT LIKE '%refunded%') / 1000.0)::int AS avg_s,
    round(avg(delay_time_ms)     FILTER (WHERE mode NOT LIKE '%refunded%') / 1000.0)::int AS avg_wait_s,
    round(avg(credits_used)      FILTER (WHERE mode NOT LIKE '%refunded%'))::int AS avg_cr
  FROM usage_log
  WHERE created_at > now() - interval '90 days'
    AND (mode LIKE '%ltx%' OR mode LIKE '%wan%' OR mode LIKE '%longlook%')
  GROUP BY 1 ORDER BY ok DESC` as any[];

console.log("  engine          ok   refund  fail%  users  gen(s) wait(s)  cr");
for (const r of rows) {
  const ok = Number(r.ok), ref = Number(r.refunded);
  const pct = ok + ref ? ((ref / (ok + ref)) * 100).toFixed(1) : "0.0";
  console.log(
    `  ${String(r.engine).padEnd(14)}${String(ok).padStart(5)}${String(ref).padStart(8)}` +
    `${pct.padStart(7)}%${String(r.users).padStart(6)}${String(r.avg_s ?? "-").padStart(8)}` +
    `${String(r.avg_wait_s ?? "-").padStart(8)}${String(r.avg_cr ?? "-").padStart(5)}`,
  );
}

console.log("\n── is LTX being retried? (same user, repeat LTX jobs within 10 min) ──");
const [retry] = await sql`
  WITH l AS (
    SELECT user_id, created_at,
           lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev
    FROM usage_log
    WHERE mode LIKE 'comfy-ltx%' AND mode NOT LIKE '%refunded%'
      AND created_at > now() - interval '90 days'
  )
  SELECT count(*) FILTER (WHERE prev IS NOT NULL AND created_at - prev < interval '10 minutes')::int AS quick,
         count(*)::int AS total
  FROM l` as any[];
console.log(`  ${retry.quick} of ${retry.total} LTX jobs came within 10 min of the same user's previous one`);
console.log("  (a high share suggests people re-rolling output they did not like)");

console.log("\n── has LTX use grown or faded since launch? ──");
const trend = await sql`
  SELECT date_trunc('month', created_at)::date AS month,
         count(*) FILTER (WHERE mode LIKE 'comfy-ltx%' AND mode NOT LIKE '%refunded%')::int AS ltx,
         count(*) FILTER (WHERE mode LIKE 'comfy-gltch-wan%' AND mode NOT LIKE '%refunded%')::int AS gltch_wan
  FROM usage_log
  WHERE created_at > now() - interval '180 days'
  GROUP BY 1 ORDER BY 1` as any[];
for (const r of trend) {
  console.log(`  ${String(r.month).slice(0, 7)}  ltx ${String(r.ltx).padStart(5)}   gltch-wan ${String(r.gltch_wan).padStart(6)}`);
}

process.exit(0);

/**
 * Cold-start readout. Run after ~24h of delay_time_ms collection to decide
 * whether raising idleTimeout is worth the idle GPU spend.
 *
 *   node --env-file=.env --import tsx scripts/cold-start-report.mts
 *
 * The question it answers: is the 40-60s wait the typical case, or the tail?
 * RunPod's delayTime is queue + worker boot, so a warm hit is near zero and a
 * cold one carries the whole model load.
 */
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const GPU_CENTS_PER_SEC = 0.155; // same rate comfyui.ts bills execution at

const [cov] = await sql`
  SELECT count(*)::int AS total,
         count(delay_time_ms)::int AS measured,
         min(created_at) AS since
  FROM usage_log
  WHERE mode LIKE 'comfy-%' AND created_at > now() - interval '7 days'`;
console.log(`\nusage_log rows (7d): ${cov.total}, with delay measured: ${cov.measured}`);
if (!cov.measured) {
  console.log("\nNothing measured yet — delay_time_ms landed 2026-08-15. Give it traffic.\n");
  process.exit(0);
}

const rows = await sql`
  SELECT mode,
         count(*)::int AS n,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_time_ms))::int AS p50,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY delay_time_ms))::int AS p90,
         round(percentile_cont(0.99) WITHIN GROUP (ORDER BY delay_time_ms))::int AS p99,
         max(delay_time_ms)::int AS worst,
         count(*) FILTER (WHERE delay_time_ms > 10000)::int AS over_10s,
         count(*) FILTER (WHERE delay_time_ms > 30000)::int AS over_30s,
         round(avg(execution_time_ms))::int AS exec_avg
  FROM usage_log
  WHERE delay_time_ms IS NOT NULL AND created_at > now() - interval '7 days'
  GROUP BY 1 ORDER BY 2 DESC`;

console.log("\nDelay (queue + worker boot), milliseconds:");
console.table(rows.map((r: any) => ({
  mode: r.mode,
  n: r.n,
  p50: r.p50,
  p90: r.p90,
  p99: r.p99,
  worst: r.worst,
  ">10s": `${r.over_10s} (${((r.over_10s / r.n) * 100).toFixed(1)}%)`,
  ">30s": `${r.over_30s} (${((r.over_30s / r.n) * 100).toFixed(1)}%)`,
  exec_avg: r.exec_avg,
})));

// The comparison that decides it: time users spend waiting on boot vs on work.
const [k] = await sql`
  SELECT count(*)::int AS n,
         sum(delay_time_ms)::bigint AS delay_total,
         sum(execution_time_ms)::bigint AS exec_total
  FROM usage_log
  WHERE mode = 'comfy-klein' AND delay_time_ms IS NOT NULL
    AND created_at > now() - interval '7 days'`;
if (k.n > 0) {
  const d = Number(k.delay_total) / 1000, e = Number(k.exec_total) / 1000;
  console.log(`\nklein (${k.n} measured jobs):`);
  console.log(`  waiting on boot : ${(d / 3600).toFixed(2)} h`);
  console.log(`  doing real work : ${(e / 3600).toFixed(2)} h`);
  console.log(`  users wait ${(d / e).toFixed(2)}× the actual GPU work`);
  console.log(`\n  If RunPod bills that boot time: $${((d * GPU_CENTS_PER_SEC) / 100).toFixed(2)} per 7d`);
  console.log(`  (compare against idle spend at a longer idleTimeout before deciding)`);
}

process.exit(0);

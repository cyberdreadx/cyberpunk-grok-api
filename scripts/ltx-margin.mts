/**
 * What an LTX render actually costs versus what it earns.
 *
 * Needed to answer whether an x2 spatial upscale can be absorbed by a price
 * rise. Credits are ~5.8c each (REGULAR: 325 for $19) and RunPod is costed at
 * RUNPOD_CENTS_PER_SEC, so both sides of the trade are knowable from
 * usage_log rather than guessed at.
 *
 *   node --env-file=.env --import tsx scripts/ltx-margin.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { RUNPOD_CENTS_PER_SEC } from "/home/neon/cyberpunk-grok-api/api/_lib/analytics.ts";

const sql = getDb();
const CENTS_PER_CREDIT = 1900 / 325; // REGULAR tier: $19 for 325 credits

const rows = await sql`
  SELECT mode,
         count(*)::int                              AS jobs,
         round(avg(execution_time_ms) / 1000.0, 1)  AS avg_s,
         round(max(execution_time_ms) / 1000.0, 1)  AS max_s,
         round(avg(credits_used), 1)                AS avg_credits
  FROM usage_log
  WHERE mode LIKE '%ltx%'
    AND mode NOT LIKE '%refunded%'
    AND execution_time_ms > 0
    AND created_at > now() - interval '60 days'
  GROUP BY mode
  ORDER BY jobs DESC` as any[];

if (!rows.length) {
  console.log("no completed LTX jobs with timings in the last 60 days");
  process.exit(0);
}

console.log(`RunPod rate ${RUNPOD_CENTS_PER_SEC}c/s · credit worth ${CENTS_PER_CREDIT.toFixed(2)}c\n`);
console.log(`${"mode".padEnd(22)}${"jobs".padStart(6)}${"avg s".padStart(8)}${"cost".padStart(9)}${"revenue".padStart(9)}${"margin".padStart(9)}${"x2 margin".padStart(11)}`);

let totJobs = 0, totCost = 0, totRev = 0, totCostX2 = 0;
for (const r of rows) {
  const cost = Number(r.avg_s) * RUNPOD_CENTS_PER_SEC;
  const rev = Number(r.avg_credits) * CENTS_PER_CREDIT;
  // An x2 spatial upscale is 4x the pixels through decode and encode. Sampling
  // dominates and is unchanged, so this is a deliberately pessimistic ceiling:
  // assume the whole job scales by 1.6x.
  const costX2 = cost * 1.6;
  totJobs += r.jobs; totCost += cost * r.jobs; totRev += rev * r.jobs; totCostX2 += costX2 * r.jobs;
  console.log(
    `${String(r.mode).padEnd(22)}${String(r.jobs).padStart(6)}${String(r.avg_s).padStart(8)}` +
    `${(cost / 100).toFixed(3).padStart(9)}${(rev / 100).toFixed(2).padStart(9)}` +
    `${(((rev - cost) / rev) * 100).toFixed(1).padStart(8)}%${(((rev - costX2) / rev) * 100).toFixed(1).padStart(10)}%`,
  );
}

console.log(`\n${totJobs} jobs over 60 days`);
console.log(`  revenue        $${(totRev / 100).toFixed(2)}`);
console.log(`  gpu cost       $${(totCost / 100).toFixed(2)}  (${((totCost / totRev) * 100).toFixed(1)}% of revenue)`);
console.log(`  gpu cost @ x2  $${(totCostX2 / 100).toFixed(2)}  (${((totCostX2 / totRev) * 100).toFixed(1)}% of revenue)`);
console.log(`  margin now ${(((totRev - totCost) / totRev) * 100).toFixed(1)}%  ->  at x2 ${(((totRev - totCostX2) / totRev) * 100).toFixed(1)}%`);
console.log(`\nprice rise needed to hold today's margin: ${((totCostX2 / totCost - 1) * (totCost / totRev) * 100).toFixed(1)}% on the LTX rate`);
process.exit(0);

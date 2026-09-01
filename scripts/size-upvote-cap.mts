/**
 * What should the daily upvote_received cap be?
 *
 * upvote_received is +5 with no cap and is 85% of the karma earn.ts pays
 * credits on, so it is the cheapest thing to farm. A cap has to sit above what
 * genuinely popular posts earn and below what a voting ring can mint, so the
 * number comes from the actual daily distribution rather than from taste.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

console.log("── daily upvote_received karma per user (days with any activity) ──");
const [d] = await sql`
  WITH daily AS (
    SELECT user_id, created_at::date AS day, sum(delta)::int AS karma
    FROM karma_events WHERE reason = 'upvote_received'
    GROUP BY 1, 2
  )
  SELECT
    count(*)::int AS user_days,
    percentile_disc(0.50) WITHIN GROUP (ORDER BY karma) AS p50,
    percentile_disc(0.90) WITHIN GROUP (ORDER BY karma) AS p90,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY karma) AS p95,
    percentile_disc(0.99) WITHIN GROUP (ORDER BY karma) AS p99,
    max(karma) AS worst
  FROM daily` as any[];
console.log(`  ${d.user_days} user-days · median ${d.p50} · p90 ${d.p90} · p95 ${d.p95} · p99 ${d.p99} · max ${d.worst}`);

console.log("\n── the heaviest single days ──");
const top = await sql`
  SELECT k.user_id, u.email, k.created_at::date AS day, sum(k.delta)::int AS karma,
         count(*)::int AS votes
  FROM karma_events k JOIN users u ON u.id = k.user_id
  WHERE k.reason = 'upvote_received'
  GROUP BY 1, 2, 3 ORDER BY karma DESC LIMIT 10` as any[];
for (const r of top) {
  console.log(`  ${String(r.karma).padStart(4)} karma (${String(r.votes).padStart(3)} upvotes)  ${String(r.day)}  ${String(r.email).slice(0, 32)}`);
}

console.log("\n── how many user-days would each candidate cap actually bite? ──");
for (const cap of [50, 75, 100, 150, 200, 300]) {
  const [r] = await sql`
    WITH daily AS (
      SELECT user_id, created_at::date AS day, sum(delta)::int AS karma
      FROM karma_events WHERE reason = 'upvote_received'
      GROUP BY 1, 2
    )
    SELECT count(*) FILTER (WHERE karma > ${cap})::int AS bitten,
           count(*)::int AS total,
           coalesce(sum(GREATEST(karma - ${cap}, 0)), 0)::int AS karma_removed
    FROM daily` as any[];
  const pct = ((r.bitten / r.total) * 100).toFixed(1);
  console.log(`  cap ${String(cap).padStart(3)}: bites ${String(r.bitten).padStart(4)} of ${r.total} user-days (${pct}%), removes ${r.karma_removed} karma`);
}

console.log("\n(a cap of N karma = N/5 upvotes a day across everything you have posted)");
process.exit(0);

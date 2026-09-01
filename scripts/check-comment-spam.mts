/**
 * What does real commenting look like, and is anyone already abusing it?
 *
 * api/comments.ts has no rate limit, no ban check, and no duplicate guard, so
 * limits should come from what normal users actually do rather than from a
 * number that feels about right.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

const [tot] = await sql`
  SELECT count(*) AS n, count(DISTINCT user_id) AS users,
         min(created_at) AS first, max(created_at) AS last
  FROM feed_comments` as any[];
console.log(`feed_comments: ${tot.n} total from ${tot.users} users`);
console.log(`  ${String(tot.first).slice(0, 16)} → ${String(tot.last).slice(0, 16)}\n`);

console.log("── busiest single minute, per user (all time) ──");
const burst = await sql`
  SELECT user_id, date_trunc('minute', created_at) AS minute, count(*) AS n
  FROM feed_comments GROUP BY 1, 2 ORDER BY n DESC LIMIT 8` as any[];
for (const r of burst) console.log(`  ${r.n} in one minute  (${String(r.user_id).slice(0, 8)} at ${String(r.minute).slice(0, 16)})`);

console.log("\n── busiest hour, per user ──");
const hour = await sql`
  SELECT user_id, date_trunc('hour', created_at) AS h, count(*) AS n
  FROM feed_comments GROUP BY 1, 2 ORDER BY n DESC LIMIT 5` as any[];
for (const r of hour) console.log(`  ${r.n} in one hour  (${String(r.user_id).slice(0, 8)})`);

console.log("\n── how many comments does one user leave on one post? ──");
const perPost = await sql`
  SELECT count(*) AS n FROM (
    SELECT user_id, post_id, count(*) AS c FROM feed_comments GROUP BY 1, 2
  ) x WHERE x.c > 5` as any[];
const [dist] = await sql`
  SELECT
    percentile_disc(0.5)  WITHIN GROUP (ORDER BY c) AS p50,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY c) AS p95,
    percentile_disc(0.99) WITHIN GROUP (ORDER BY c) AS p99,
    max(c) AS worst
  FROM (SELECT user_id, post_id, count(*) AS c FROM feed_comments GROUP BY 1, 2) x` as any[];
console.log(`  median ${dist.p50}, p95 ${dist.p95}, p99 ${dist.p99}, worst ${dist.worst}`);
console.log(`  (user, post) pairs with more than 5 comments: ${perPost[0].n}`);

console.log("\n── exact duplicate text by the same user on the same post ──");
const dupes = await sql`
  SELECT user_id, post_id, text, count(*) AS n
  FROM feed_comments GROUP BY 1, 2, 3 HAVING count(*) > 1
  ORDER BY n DESC LIMIT 6` as any[];
if (!dupes.length) console.log("  none");
for (const d of dupes) {
  console.log(`  ${d.n}× "${String(d.text).slice(0, 44).replace(/\n/g, " ")}"  (${String(d.user_id).slice(0, 8)})`);
}

console.log("\n── empty or whitespace-only comments that got through ──");
const [blank] = await sql`
  SELECT count(*) AS n FROM feed_comments WHERE trim(coalesce(text, '')) = ''` as any[];
console.log(`  ${blank.n}`);

console.log("\n── comments from accounts that are banned ──");
const [banned] = await sql`
  SELECT count(*) AS n FROM feed_comments c
  JOIN user_bans b ON b.user_id = c.user_id` as any[];
console.log(`  ${banned.n}`);

process.exit(0);

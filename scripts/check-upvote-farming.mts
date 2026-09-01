/**
 * Where the credit-earning karma actually comes from.
 *
 * Only three reasons convert to credits (api/earn.ts QUALIFIED_REASONS):
 * upvote_received (+5), story_like_received (+1), comment_received (+2).
 * upvote_received is worth 5 and has no daily cap, so it is the cheapest
 * thing to farm — an alt account upvoting is +5, a comment is +2.
 *
 * Looks for reciprocal voting rings and for accounts whose votes come from
 * an unusually small set of voters.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

console.log("── credit-qualified karma only (what earn.ts pays on) ──");
const q = await sql`
  SELECT reason, count(*) AS n, sum(delta) AS karma
  FROM karma_events
  WHERE reason IN ('upvote_received', 'story_like_received', 'comment_received')
  GROUP BY reason ORDER BY karma DESC` as any[];
let total = 0;
for (const r of q) total += Number(r.karma);
for (const r of q) {
  console.log(`  ${String(r.reason).padEnd(22)} ${String(r.karma).padStart(6)} karma  ${Math.round((Number(r.karma) / total) * 100)}% of what pays`);
}

console.log("\n── reciprocal voting: A upvotes B and B upvotes A ──");
const pairs = await sql`
  WITH e AS (
    SELECT r.user_id AS voter, p.user_id AS author, count(*) AS n
    FROM reactions r JOIN feed_posts p ON p.id = r.post_id
    WHERE r.user_id <> p.user_id
    GROUP BY 1, 2
  )
  SELECT a.voter AS u1, a.author AS u2, a.n AS a_to_b, b.n AS b_to_a
  FROM e a JOIN e b ON b.voter = a.author AND b.author = a.voter
  WHERE a.voter < a.author AND (a.n + b.n) >= 10
  ORDER BY (a.n + b.n) DESC LIMIT 10` as any[];
if (!pairs.length) console.log("  no pair with 10+ mutual reactions");
for (const p of pairs) {
  const [e1] = await sql`SELECT email FROM users WHERE id = ${p.u1}::uuid` as any[];
  const [e2] = await sql`SELECT email FROM users WHERE id = ${p.u2}::uuid` as any[];
  console.log(`  ${String(e1?.email).slice(0, 28).padEnd(28)} ⇄ ${String(e2?.email).slice(0, 28).padEnd(28)} ${p.a_to_b}/${p.b_to_a}`);
}

console.log("\n── concentration: whose upvotes come from the fewest people ──");
const conc = await sql`
  SELECT p.user_id, u.email, u.karma,
         count(*) AS votes, count(DISTINCT r.user_id) AS voters,
         (count(*)::float / GREATEST(count(DISTINCT r.user_id), 1))::numeric(6,1) AS per_voter
  FROM reactions r JOIN feed_posts p ON p.id = r.post_id
  JOIN users u ON u.id = p.user_id
  WHERE r.user_id <> p.user_id
  GROUP BY p.user_id, u.email, u.karma
  HAVING count(*) >= 30
  ORDER BY per_voter DESC LIMIT 8` as any[];
console.log("  votes/voters  votes  voters  karma  account");
for (const r of conc) {
  console.log(`  ${String(r.per_voter).padStart(11)}  ${String(r.votes).padStart(5)}  ${String(r.voters).padStart(6)}  ${String(r.karma).padStart(5)}  ${String(r.email).slice(0, 30)}`);
}

console.log("\n── credits actually paid out for karma ──");
try {
  const rows = await sql`
    SELECT count(*) AS claims, coalesce(sum(amount), 0) AS credits, count(DISTINCT user_id) AS users
    FROM credit_ledger WHERE reason LIKE '%karma%' OR reason LIKE '%engagement%'` as any[];
  console.log(`  ${rows[0].claims} grants, ${rows[0].credits} credits, ${rows[0].users} users`);
} catch (e: any) {
  console.log(`  (credit_ledger: ${e.message.slice(0, 60)})`);
}

process.exit(0);

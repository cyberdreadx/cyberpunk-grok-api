/**
 * Is anyone farming credits through comment karma?
 *
 * comment_received awarded +2 karma per comment with no daily cap, and karma
 * converts to credits in api/earn.ts (milestones 25→5cr up to 2500→75cr, plus
 * a weekly engagement payout). Two accounts commenting on each other's posts
 * therefore minted real credits for as long as they kept typing.
 *
 * This looks for the shape of that: reciprocal commenting pairs, and karma
 * that is mostly comment_received.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

console.log("── karma by source ──");
const bySource = await sql`
  SELECT reason, count(*) AS n, sum(delta) AS karma
  FROM karma_events GROUP BY reason ORDER BY karma DESC LIMIT 10` as any[];
for (const r of bySource) {
  console.log(`  ${String(r.reason).padEnd(20)} ${String(r.n).padStart(6)} events  ${String(r.karma).padStart(7)} karma`);
}

console.log("\n── top karma earners, and how much of it came from comments ──");
const top = await sql`
  SELECT k.user_id, u.email, u.karma,
         sum(k.delta) FILTER (WHERE k.reason = 'comment_received') AS from_comments,
         sum(k.delta) AS total_logged
  FROM karma_events k JOIN users u ON u.id = k.user_id
  GROUP BY k.user_id, u.email, u.karma
  ORDER BY sum(k.delta) FILTER (WHERE k.reason = 'comment_received') DESC NULLS LAST
  LIMIT 8` as any[];
for (const r of top) {
  const pct = Number(r.total_logged) ? Math.round((Number(r.from_comments || 0) / Number(r.total_logged)) * 100) : 0;
  console.log(`  ${String(r.email).slice(0, 30).padEnd(30)} karma=${String(r.karma).padStart(5)}  from comments=${String(r.from_comments || 0).padStart(5)} (${pct}%)`);
}

console.log("\n── reciprocal commenting: A comments on B's posts and B on A's ──");
const pairs = await sql`
  WITH edges AS (
    SELECT c.user_id AS commenter, p.user_id AS author, count(*) AS n
    FROM feed_comments c JOIN feed_posts p ON p.id = c.post_id
    WHERE c.user_id <> p.user_id
    GROUP BY 1, 2
  )
  SELECT a.commenter AS u1, a.author AS u2, a.n AS a_to_b, b.n AS b_to_a
  FROM edges a JOIN edges b ON b.commenter = a.author AND b.author = a.commenter
  WHERE a.commenter < a.author
  ORDER BY (a.n + b.n) DESC LIMIT 8` as any[];
if (!pairs.length) console.log("  none");
for (const p of pairs) {
  const [e1] = await sql`SELECT email FROM users WHERE id = ${p.u1}::uuid` as any[];
  const [e2] = await sql`SELECT email FROM users WHERE id = ${p.u2}::uuid` as any[];
  console.log(`  ${String(e1?.email).slice(0, 26).padEnd(26)} ⇄ ${String(e2?.email).slice(0, 26).padEnd(26)} ${p.a_to_b}/${p.b_to_a} comments`);
}

console.log("\n── credits already paid out for karma ──");
let paid: any[] = [];
try {
  paid = await sql`
    SELECT count(*) AS claims, coalesce(sum(credits), 0) AS credits, count(DISTINCT user_id) AS users
    FROM karma_events WHERE reason = 'milestone_claim'` as any[];
} catch { console.log("  (karma_claims table not present under that name)"); }
if (paid[0]) console.log(`  ${paid[0].claims} claims, ${paid[0].credits} credits, ${paid[0].users} users`);

process.exit(0);

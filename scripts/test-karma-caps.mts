/**
 * Daily karma caps, on the real awardKarma.
 *
 * upvote_received (+5), comment_received (+2) and story_like_received (+1) are
 * the three reasons earn.ts converts to credits, and all three were uncapped —
 * a voting, commenting or story-liking ring minted them without limit. These
 * assert the ceilings hold, that they are per-user and per-reason rather than
 * shared, that reverting frees the allowance again so a deleted post does not
 * permanently burn someone's day, and that no qualifying reason is left
 * unbounded.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { awardKarma, revertKarma } from "/home/neon/cyberpunk-grok-api/api/_lib/karma.ts";

const sql = getDb();
const P = "karmacap";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const cleanup = async () => {
  await sql`DELETE FROM karma_events WHERE source_key LIKE ${P + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
};
await cleanup();

async function mkUser(tag: string) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true) RETURNING id`;
  return u.id as string;
}

const todaysKarma = async (userId: string, reason: string) => {
  const [r] = await sql`
    SELECT COALESCE(SUM(delta), 0)::int AS n FROM karma_events
    WHERE user_id = ${userId}::uuid AND reason = ${reason}
      AND created_at >= date_trunc('day', now())` as any[];
  return Number(r.n);
};

try {
  console.log("── upvote_received stops at 150/day ──");
  const a = await mkUser("a");
  let awarded = 0;
  for (let i = 0; i < 40; i++) {
    if (await awardKarma(sql, a, "upvote_received", `${P}-a-up-${i}`)) awarded++;
  }
  const aTotal = await todaysKarma(a, "upvote_received");
  ok("40 upvotes (200 karma) are cut off at the cap", aTotal <= 150, `${aTotal} karma from ${awarded} awards`);
  ok("…and it lands right at the ceiling", aTotal === 150, `${aTotal}`);
  ok("further upvotes are refused", (await awardKarma(sql, a, "upvote_received", `${P}-a-up-extra`)) === false);

  console.log("\n── comment_received stops at 40/day ──");
  const b = await mkUser("b");
  for (let i = 0; i < 30; i++) await awardKarma(sql, b, "comment_received", `${P}-b-cm-${i}`);
  const bTotal = await todaysKarma(b, "comment_received");
  ok("30 comments (60 karma) are cut off", bTotal === 40, `${bTotal} karma`);

  console.log("\n── story_like_received stops at 20/day ──");
  const e = await mkUser("e");
  for (let i = 0; i < 30; i++) await awardKarma(sql, e, "story_like_received", `${P}-e-sl-${i}`);
  const eTotal = await todaysKarma(e, "story_like_received");
  ok("30 story likes are cut off at 20", eTotal === 20, `${eTotal} karma`);

  console.log("\n── every reason earn.ts pays on is now capped ──");
  const uncapped: string[] = [];
  for (const reason of ["upvote_received", "comment_received", "story_like_received"] as const) {
    const f = await mkUser(`cap-${reason.slice(0, 6)}`);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      if (await awardKarma(sql, f, reason, `${P}-${reason}-${i}`)) n++; else break;
    }
    if (n >= 400) uncapped.push(reason);
  }
  ok("none of the three can be minted without limit", uncapped.length === 0,
    uncapped.length ? `still uncapped: ${uncapped.join(", ")}` : "all three stop");

  console.log("\n── the cap is per reason, not shared ──");
  ok("b can still earn upvote karma", (await awardKarma(sql, b, "upvote_received", `${P}-b-up-1`)) === true);

  console.log("\n── the cap is per user, not global ──");
  const c = await mkUser("c");
  ok("a fresh account starts with its own allowance",
    (await awardKarma(sql, c, "upvote_received", `${P}-c-up-1`)) === true);
  ok("…and a's exhausted cap did not follow it", (await todaysKarma(c, "upvote_received")) === 5);

  console.log("\n── reverting frees the allowance again ──");
  await revertKarma(sql, `${P}-a-up-0`);
  const afterRevert = await todaysKarma(a, "upvote_received");
  ok("the reverted event is gone", afterRevert === 145, `${afterRevert} karma`);
  ok("a can earn again up to the cap",
    (await awardKarma(sql, a, "upvote_received", `${P}-a-up-refill`)) === true,
    "a deleted post must not permanently burn someone's day");

  console.log("\n── idempotency still holds ──");
  const d = await mkUser("d");
  await awardKarma(sql, d, "upvote_received", `${P}-d-same`);
  ok("the same source_key never double-awards",
    (await awardKarma(sql, d, "upvote_received", `${P}-d-same`)) === false);

  console.log("\n── what a ring could mint before vs after ──");
  console.log(`     before: unbounded (the observed worst real day was 720 karma)`);
  console.log(`     after:  150 upvote + 40 comment + 20 story-like karma per account per day,`);
  console.log(`             and earn.ts still caps the weekly payout at 15 credits`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "CAPS HOLD" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

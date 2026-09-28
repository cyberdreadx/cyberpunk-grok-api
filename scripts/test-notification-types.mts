/**
 * Every notification type the app sends must survive the database.
 *
 * The table's CHECK constraint allowed a vocabulary the code had long since
 * stopped using: of comment/follow/unlock/dm/system/upvote/credits, only two
 * were accepted, and notify() swallows its own errors, so upvotes, unlocks, DMs
 * and system notices were silently discarded for months.
 *
 *   node --env-file=.env --import tsx scripts/test-notification-types.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { notify } from "/home/neon/cyberpunk-grok-api/api/_lib/notify.ts";

const sql = getDb();
const P = "notiftypetest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

async function cleanup() {
  const ids = ((await sql`SELECT id FROM users WHERE email LIKE ${P + "-%"}`) as any[]).map((r) => r.id);
  if (ids.length) await sql`DELETE FROM notifications WHERE user_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "-%"}`;
}

await cleanup();
try {
  const [me] = (await sql`INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}-me@example.test`}, 'x', false) RETURNING id`) as any[];
  const [actor] = (await sql`INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}-actor@example.test`}, 'x', false) RETURNING id`) as any[];

  // Every type that appears in a notify() call, plus the two the prefs file
  // knows about, so adding one to the code without the DB fails here first.
  const TYPES = ["comment", "follow", "unlock", "dm", "system", "upvote", "credits"];
  for (const type of TYPES) {
    await notify({
      userId: String(me.id), type, title: `${type} happened`,
      actorId: String(actor.id), actorUsername: "tester",
      noEmail: true,
    });
    const [row] = (await sql`SELECT COUNT(*)::int n FROM notifications
      WHERE user_id = ${me.id}::uuid AND type = ${type}`) as any[];
    ok(`a "${type}" notification reaches the database`, row.n === 1);
  }

  console.log("\n── the rules that should still hold ──");
  const before = (await sql`SELECT COUNT(*)::int n FROM notifications WHERE user_id = ${me.id}::uuid`) as any[];
  await notify({ userId: String(me.id), type: "upvote", title: "self", actorId: String(me.id), noEmail: true });
  const after = (await sql`SELECT COUNT(*)::int n FROM notifications WHERE user_id = ${me.id}::uuid`) as any[];
  ok("you are never notified about your own action", after[0].n === before[0].n);

  await notify({ userId: String(me.id), type: "not_a_real_type", title: "nope", noEmail: true });
  const [bogus] = (await sql`SELECT COUNT(*)::int n FROM notifications
    WHERE user_id = ${me.id}::uuid AND type = 'not_a_real_type'`) as any[];
  ok("an unknown type is still refused (the constraint still guards)", bogus.n === 0);

  const [unread] = (await sql`SELECT COUNT(*)::int n FROM notifications
    WHERE user_id = ${me.id}::uuid AND read = false`) as any[];
  ok("everything lands unread, so the bell can show it", unread.n === TYPES.length);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

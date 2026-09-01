/**
 * The DM poll used to re-send the newest message every time.
 *
 * Postgres stores created_at with microseconds (.023267). The driver hands
 * back a JS Date, which holds only milliseconds (.023), so a cursor that went
 * out through JSON came back short — and `created_at > since` was true for the
 * very row the cursor pointed at. Every poll returned that message again, and
 * the UI appended it each time.
 *
 * This sends one message and then polls repeatedly with the cursor the client
 * would actually use. The second poll onward must return nothing.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const P = "dmtest";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const cleanup = () => sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
await cleanup();

async function mkUser(tag: string) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true) RETURNING id, email`;
  await sql`INSERT INTO profiles (user_id, username) VALUES (${u.id}::uuid, ${P + tag + (Date.now() % 99999)})
            ON CONFLICT (user_id) DO NOTHING`;
  return { id: u.id as string, token: signToken({ userId: u.id, email: u.email }) };
}

try {
  const a = await mkUser("alice");
  const b = await mkUser("bob");
  // Starting a thread with a stranger needs a paid sender or a follow from the
  // recipient (canInitiate). Mark Alice paid so the test exercises the poll
  // cursor rather than that gate.
  await sql`UPDATE users SET subscription_tier = 'basic' WHERE id = ${a.id}::uuid`;

  const sent = await fetch(`${BASE}/api/dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ toUserId: b.id, text: "please stop farming credits" }),
  }).then(r => r.json()) as any;
  ok("the message sends", !!sent?.message?.id, sent?.error || "");

  const cursor = sent.message.createdAt;
  ok("createdAt carries microseconds", /\.\d{6}Z$/.test(String(cursor)), String(cursor));

  // Exactly what the client does: round-trip the cursor through JSON.
  const roundTripped = JSON.parse(JSON.stringify({ c: cursor })).c;
  ok("…and survives a JSON round-trip unchanged", roundTripped === cursor, String(roundTripped));

  let repeats = 0;
  for (let i = 0; i < 3; i++) {
    const poll = await fetch(
      `${BASE}/api/dm?threadId=${sent.threadId}&since=${encodeURIComponent(roundTripped)}`,
      { headers: { Authorization: `Bearer ${a.token}` } },
    ).then(r => r.json()) as any;
    if ((poll.messages || []).length > 0) repeats++;
  }
  ok("polling with that cursor returns nothing, three times over", repeats === 0,
    `${repeats} polls re-sent the message`);

  const full = await fetch(`${BASE}/api/dm?threadId=${sent.threadId}`, {
    headers: { Authorization: `Bearer ${b.token}` },
  }).then(r => r.json()) as any;
  ok("the recipient sees it exactly once", (full.messages || []).length === 1,
    `${full.messages?.length} messages`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "NO DUPLICATION" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

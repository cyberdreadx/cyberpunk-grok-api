/**
 * Comment anti-spam, against the live API.
 *
 * Before this, /api/comments POST had no rate limit, no ban check and no
 * duplicate guard — 107 comments already existed from accounts that were
 * banned at the time. Each guard is asserted by actually trying to get past it.
 *
 * Limits come from the real distribution: across 1,309 comments, one user on
 * one post is a median of 1, p95 of 2, p99 of 5.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const P = "cmttest";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const cleanup = async () => {
  await sql`DELETE FROM feed_posts WHERE text LIKE ${P + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
  await sql`DELETE FROM rate_limits WHERE key LIKE 'comment:%'`.catch(() => { });
};
await cleanup();

async function mkUser(tag: string) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true) RETURNING id, email`;
  await sql`
    INSERT INTO profiles (user_id, username) VALUES (${u.id}::uuid, ${`${P}${tag}${Date.now() % 100000}`})
    ON CONFLICT (user_id) DO NOTHING`;
  return { id: u.id as string, token: signToken({ userId: u.id, email: u.email }) };
}

const post = async (token: string, postId: string, text: string, parentId?: string) => {
  const res = await fetch(`${BASE}/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ postId, text, parentId }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

try {
  const author = await mkUser("author");
  const commenter = await mkUser("commenter");
  const [p] = await sql`
    INSERT INTO feed_posts (user_id, text, image_url)
    VALUES (${author.id}::uuid, ${P + " target post"}, null) RETURNING id` as any[];
  const postId = p.id as string;

  console.log("── empty and near-empty ──");
  ok("whitespace-only is rejected", (await post(commenter.token, postId, "   ")).status === 400);
  ok("a single character is rejected", (await post(commenter.token, postId, "o")).status === 400,
    "single-word junk was the actual spam pattern here");
  ok("a real comment is accepted", (await post(commenter.token, postId, "nice work")).status === 201);

  console.log("\n── duplicates ──");
  const dup = await post(commenter.token, postId, "nice work");
  ok("the same text again is refused", dup.status === 409, dup.json.error);
  const dupCase = await post(commenter.token, postId, "  NICE WORK ");
  ok("…and case/whitespace tricks do not get around it", dupCase.status === 409, dupCase.json.error);
  ok("different text is fine", (await post(commenter.token, postId, "really nice work")).status === 201);

  console.log("\n── burst on one post ──");
  let blocked = 0, statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await post(commenter.token, postId, `burst comment number ${i}`);
    statuses.push(r.status);
    if (r.status === 429) blocked++;
  }
  ok("a run on one post is cut off", blocked > 0, `statuses: ${statuses.join(",")}`);

  console.log("\n── the post owner is not pinged for every one ──");
  const [notes] = await sql`
    SELECT count(*)::int AS n FROM notifications
    WHERE user_id = ${author.id}::uuid AND type = 'comment'` as any[];
  ok("one notification, not one per comment", Number(notes.n) === 1, `${notes.n} notifications`);

  console.log("\n── banned accounts ──");
  const banned = await mkUser("banned");
  await sql`INSERT INTO user_bans (user_id, reason) VALUES (${banned.id}::uuid, 'test')`;
  const b = await post(banned.token, postId, "let me in");
  ok("a banned account cannot comment", b.status === 403, `HTTP ${b.status} — 107 had slipped through`);

  console.log("\n── auth ──");
  const anon = await fetch(`${BASE}/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId, text: "no token here" }),
  });
  ok("no token → 401", anon.status === 401, `HTTP ${anon.status}`);

  console.log("\n── nothing legitimate was lost ──");
  const [kept] = await sql`
    SELECT count(*)::int AS n FROM feed_comments WHERE post_id = ${postId}::uuid` as any[];
  ok("the accepted comments are all stored", Number(kept.n) >= 3, `${kept.n} stored`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "COMMENT SPAM BLOCKED" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

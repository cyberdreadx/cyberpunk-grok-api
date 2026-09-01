/**
 * Anti-farm promo — every rule, against the live API.
 *
 * The rules that matter are database constraints (migration 061), so these
 * assertions go through real HTTP with real JWTs rather than calling the
 * helpers directly: what matters is that a determined caller cannot get a
 * second payout, not that the happy path works.
 *
 * Creates scratch accounts and codes, then deletes everything.
 */
process.env.RESEND_API_KEY = "";

import { randomBytes } from "crypto";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";
import { hashCode, normalizePostUrl } from "/home/neon/cyberpunk-grok-api/api/_lib/promo.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";
const P = "promotest";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const cleanup = async () => {
  await sql`DELETE FROM promo_claims WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${P + "%"})`;
  await sql`DELETE FROM promo_codes WHERE label = 'promotest'`;
  await sql`DELETE FROM rate_limits WHERE key LIKE ${"promo:%"} AND key IN (
    SELECT 'promo:' || id FROM users WHERE email LIKE ${P + "%"})`.catch(() => { });
  await sql`DELETE FROM usage_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${P + "%"})`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
};
await cleanup();

/** A scratch account, aged and given render history by direct insert. */
async function mkUser(tag: string, ageDays: number, renders: number) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified, created_at, pack_credits)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true, now() - (${ageDays} || ' days')::interval, 0)
    RETURNING id, email`;
  for (let i = 0; i < renders; i++) {
    await sql`
      INSERT INTO usage_log (user_id, mode, credits_used, prompt)
      VALUES (${u.id}::uuid, 'comfy-klein', 3, 'test render')`;
  }
  return { id: u.id as string, token: signToken({ userId: u.id, email: u.email }) };
}

async function mkCode() {
  const code = `GLTCH-TEST-${randomBytes(3).toString("hex").toUpperCase()}`;
  await sql`INSERT INTO promo_codes (code_hash, label) VALUES (${hashCode(code)}, 'promotest')`;
  return code;
}

const call = async (path: string, token: string, body?: any, method?: string) => {
  const res = await fetch(`${BASE}${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

const post = (n: string) => `https://antireddit.com/c/gltchrunner/${n}`;

const [admin] = await sql`SELECT id, email FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1`;
const adminToken = signToken({ userId: admin.id, email: admin.email });

try {
  console.log("── URL normalisation (rule 6: no empty posts, no duplicates) ──");
  ok("a blank string is not a post", normalizePostUrl("") === null);
  ok("a non-AntiReddit link is rejected", normalizePostUrl("https://reddit.com/r/x/1") === null);
  ok("the bare host is not a post", normalizePostUrl("https://antireddit.com") === null);
  ok("junk text is rejected", normalizePostUrl("check out my post!") === null);
  ok("tracking params don't make a new post",
    normalizePostUrl(post("abc") + "?utm_source=x") === normalizePostUrl(post("abc")));
  ok("a trailing slash doesn't either",
    normalizePostUrl(post("abc") + "/") === normalizePostUrl(post("abc")));
  ok("case doesn't either", normalizePostUrl(post("ABC")) === normalizePostUrl(post("abc")));

  console.log("\n── rule 1 + 2: account age and render count ──");
  const tooNew = await mkUser("toonew", 2, 10);
  const noRenders = await mkUser("norenders", 30, 1);
  const good = await mkUser("good", 30, 5);

  const newState = await call("/api/promo-claim", tooNew.token);
  ok("a 2-day-old account is ineligible", newState.json.eligible === false,
    JSON.stringify(newState.json.reasons));
  const nrState = await call("/api/promo-claim", noRenders.token);
  ok("1 render is ineligible", nrState.json.eligible === false, JSON.stringify(nrState.json.reasons));
  const goodState = await call("/api/promo-claim", good.token);
  ok("30 days + 5 renders is eligible", goodState.json.eligible === true,
    JSON.stringify(goodState.json.reasons));

  console.log("\n── the ineligible cannot submit anyway ──");
  const sneak = await call("/api/promo-claim", tooNew.token, { postUrl: post("sneak"), code: await mkCode() });
  ok("a too-new account is refused at POST", sneak.status === 403, `HTTP ${sneak.status}`);

  console.log("\n── invite codes (single use) ──");
  const codeA = await mkCode();
  const noCode = await call("/api/promo-claim", good.token, { postUrl: post("nocode") });
  ok("a claim without a code is refused", noCode.status === 400, noCode.json.error);
  const badCode = await call("/api/promo-claim", good.token, { postUrl: post("bad"), code: "GLTCH-NOPE-NOPE" });
  ok("an unknown code is refused", badCode.status === 400, badCode.json.error);

  const first = await call("/api/promo-claim", good.token, { postUrl: post("real-1"), code: codeA });
  ok("a valid claim is created as pending", first.status === 201 && first.json.claim?.status === "pending",
    `HTTP ${first.status}`);

  const user2 = await mkUser("second", 30, 5);
  const reuse = await call("/api/promo-claim", user2.token, { postUrl: post("real-2"), code: codeA });
  ok("the same code cannot be used twice", reuse.status === 400, reuse.json.error);

  console.log("\n── rule 3 + 6: one open claim, one post ──");
  // A fresh account per assertion: the 3-attempts-a-day limit is counted before
  // validation (probing codes must cost the same as a real try), so reusing an
  // account here would report 429 instead of the rule under test.
  const dupUser = await mkUser("duppending", 30, 5);
  await call("/api/promo-claim", dupUser.token, { postUrl: post("dup-1"), code: await mkCode() });
  const dupPending = await call("/api/promo-claim", dupUser.token, { postUrl: post("dup-2"), code: await mkCode() });
  ok("a second pending claim is refused", dupPending.status === 409, dupPending.json.error);

  const samePost = await call("/api/promo-claim", user2.token, { postUrl: post("real-1"), code: await mkCode() });
  ok("someone else cannot claim the same post", samePost.status === 409, samePost.json.error);

  console.log("\n── admin review ──");
  const anon = await call("/api/admin/promo", good.token);
  ok("a normal user cannot see the queue", anon.status === 403, `HTTP ${anon.status}`);

  const queue = await call("/api/admin/promo?status=pending", adminToken);
  ok("admin sees the pending queue", queue.status === 200);
  const mine = queue.json.claims?.find((c: any) => c.id === first.json.claim.id);
  ok("the claim carries the review facts", !!mine && mine.renderCount === 5 && mine.accountAgeDays >= 29,
    mine ? `${mine.accountAgeDays}d, ${mine.renderCount} renders` : "not found");

  console.log("\n── approval pays exactly once ──");
  const before = await sql`SELECT pack_credits FROM users WHERE id = ${good.id}::uuid`;
  const okApprove = await call("/api/admin/promo", adminToken, { claimId: first.json.claim.id, action: "approve" });
  ok("approve succeeds", okApprove.status === 200, `HTTP ${okApprove.status} ${okApprove.json.error || ""}`);
  const after = await sql`SELECT pack_credits FROM users WHERE id = ${good.id}::uuid`;
  const paid = Number(after[0].pack_credits) - Number(before[0].pack_credits);
  ok(`credits landed (${okApprove.json.creditsAwarded})`, paid === okApprove.json.creditsAwarded, `+${paid}`);

  const twice = await call("/api/admin/promo", adminToken, { claimId: first.json.claim.id, action: "approve" });
  ok("approving the same claim again is refused", twice.status === 409, twice.json.error);
  const after2 = await sql`SELECT pack_credits FROM users WHERE id = ${good.id}::uuid`;
  ok("…and pays nothing", Number(after2[0].pack_credits) === Number(after[0].pack_credits));

  console.log("\n── rule 3: one payout per user, ever ──");
  const already = await call("/api/promo-claim", good.token);
  ok("a paid account is no longer eligible", already.json.eligible === false,
    JSON.stringify(already.json.reasons));
  // Again a fresh account, paid via the admin path so none of its own three
  // daily attempts are spent before the assertion.
  const paidUser = await mkUser("paid", 30, 5);
  const paidClaim = await call("/api/promo-claim", paidUser.token, { postUrl: post("paid-1"), code: await mkCode() });
  await call("/api/admin/promo", adminToken, { claimId: paidClaim.json.claim.id, action: "approve" });
  const claimAgain = await call("/api/promo-claim", paidUser.token, { postUrl: post("greedy"), code: await mkCode() });
  ok("a paid account cannot claim again", claimAgain.status === 403, claimAgain.json.error);

  const secondRow = await sql`
    INSERT INTO promo_claims (user_id, post_url, post_url_norm, status)
    VALUES (${good.id}::uuid, ${post("x")}, ${"antireddit.com/c/gltchrunner/x"}, 'pending')
    RETURNING id`;
  const forced = await call("/api/admin/promo", adminToken, { claimId: secondRow[0].id, action: "approve" });
  ok("even a hand-inserted second claim cannot be approved", forced.status === 409,
    `HTTP ${forced.status} — the partial unique index holds`);
  const after3 = await sql`SELECT pack_credits FROM users WHERE id = ${good.id}::uuid`;
  ok("…and still pays nothing", Number(after3[0].pack_credits) === Number(after[0].pack_credits));

  console.log("\n── rejection releases the code and frees the post ──");
  const rejUser = await mkUser("rejected", 30, 5);
  const rejCode = await mkCode();
  const toReject = await call("/api/promo-claim", rejUser.token, { postUrl: post("junk"), code: rejCode });
  ok("a claim to reject was created", toReject.status === 201, `HTTP ${toReject.status}`);
  const rejected = await call("/api/admin/promo", adminToken,
    { claimId: toReject.json.claim.id, action: "reject", reason: "empty post" });
  ok("reject succeeds", rejected.status === 200, rejected.json.error || "");
  const [freed] = await sql`SELECT used_by FROM promo_codes WHERE code_hash = ${hashCode(rejCode)}` as any[];
  ok("the code is released for reuse", freed?.used_by === null, `used_by=${freed?.used_by}`);
  const [rejRow] = await sql`
    SELECT status, credits_awarded FROM promo_claims WHERE id = ${toReject.json.claim.id}::uuid` as any[];
  ok("a rejected claim pays nothing", rejRow.status === "rejected" && rejRow.credits_awarded === 0);

  console.log("\n── rate limit: 3 attempts per user per day ──");
  const spammer = await mkUser("spam", 30, 5);
  let last = 0;
  for (let i = 0; i < 5; i++) {
    const r = await call("/api/promo-claim", spammer.token, { postUrl: post(`spam-${i}`), code: "GLTCH-BAD-CODE" });
    last = r.status;
  }
  ok("the 4th+ attempt is rate limited", last === 429, `HTTP ${last}`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "PROMO RULES HOLD" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

/**
 * End-to-end proof that an ambassador link actually pays out attribution:
 * click the link, sign up through the real signup handler, and check that a
 * row lands in ambassador_referrals.
 *
 * This is the one path in the program that has never fired in production —
 * two active ambassadors, one tracked click, zero referrals — so the
 * assertions here are the only evidence it works.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { normalizeCode } from "/home/neon/cyberpunk-grok-api/api/_lib/ambassador.ts";
import { signCaptchaToken } from "/home/neon/cyberpunk-grok-api/api/_lib/captcha.ts";

const signupMod: any = await import("/home/neon/cyberpunk-grok-api/api/auth/signup.ts");
const signup = signupMod.default?.default ?? signupMod.default;
const ambMod: any = await import("/home/neon/cyberpunk-grok-api/api/ambassador.ts");
const ambassadorApi = ambMod.default?.default ?? ambMod.default;

const sql = getDb();
const P = "ambattr";
const CODE = "AMBATTRTEST";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.setHeader = () => r; r.end = () => r;
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}

async function call(handler: any, req: any) {
  const res = mockRes();
  await handler({ headers: {}, query: {}, ...req }, res);
  return res;
}

// The signup handler runs a CAPTCHA check, so mint a genuinely valid token
// rather than stubbing the check out — the point is to exercise the real path.
async function doSignup(email: string, referral_code?: string, fingerprint?: string) {
  const answer = "42";
  return call(signup, {
    method: "POST",
    body: {
      email,
      password: "test-Password-123",
      referral_code,
      device_fingerprint: fingerprint,
      captcha_token: signCaptchaToken(answer),
      captcha_answer: answer,
    },
    headers: { "x-forwarded-for": "203.0.113.77", "user-agent": "attr-test" },
  });
}

async function cleanup() {
  await sql`DELETE FROM ambassador_referrals WHERE ambassador_id IN (SELECT id FROM ambassadors WHERE code = ${CODE})`;
  await sql`DELETE FROM ambassador_click_days WHERE ambassador_id IN (SELECT id FROM ambassadors WHERE code = ${CODE})`;
  await sql`DELETE FROM ambassador_click_seen WHERE ambassador_id IN (SELECT id FROM ambassadors WHERE code = ${CODE})`;
  await sql`DELETE FROM ambassadors WHERE code = ${CODE}`;
  await sql`DELETE FROM referrals WHERE referrer_id IN (SELECT id FROM users WHERE email LIKE ${P + "%"})
                                      OR referee_id IN (SELECT id FROM users WHERE email LIKE ${P + "%"})`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
}

await cleanup();

try {
  // An approved ambassador with a vanity code.
  const [ambUser] = await sql`
    INSERT INTO users (email, password_hash, email_verified)
    VALUES (${`${P}-amb@example.test`}, 'x', true) RETURNING id`;
  const [amb] = await sql`
    INSERT INTO ambassadors (user_id, code, status, commission_pct, commission_months)
    VALUES (${ambUser.id}::uuid, ${CODE}, 'active', 20.00, 12) RETURNING id`;

  console.log("\n── the link records a click before anyone signs up ──");
  const track = await call(ambassadorApi, {
    method: "POST",
    body: { action: "track", code: CODE },
    headers: { "x-forwarded-for": "203.0.113.77", "user-agent": "attr-test" },
  });
  ok("track responds 200", track.statusCode === 200, `got ${track.statusCode}`);
  const [clicks] = await sql`
    SELECT COALESCE(sum(clicks),0)::int AS n FROM ambassador_click_days WHERE ambassador_id = ${amb.id}::uuid`;
  ok("a click is recorded", clicks.n >= 1, `clicks=${clicks.n}`);

  console.log("\n── signing up with the code attributes the user ──");
  const email = `${P}-referee@example.test`;
  const s = await doSignup(email, CODE, `${P}-fp-1`);
  ok("signup succeeds", s.statusCode === 201, `got ${s.statusCode} ${JSON.stringify(s.body).slice(0, 120)}`);
  const [referee] = await sql`SELECT id, referred_by FROM users WHERE email = ${email}`;
  ok("account exists", !!referee);
  ok("referred_by points at the ambassador", referee?.referred_by === ambUser.id);

  const [row] = await sql`
    SELECT ambassador_id, user_id, commission_until, disqualified, signup_fingerprint
    FROM ambassador_referrals WHERE user_id = ${referee.id}::uuid`;
  ok("ambassador_referrals row created", !!row, row ? "" : "NO ROW");
  ok("…attached to the right ambassador", row?.ambassador_id === amb.id);
  ok("…not disqualified", row?.disqualified === false);
  ok("…with a commission window set", !!row?.commission_until,
    row?.commission_until ? `until ${new Date(row.commission_until).toISOString().slice(0, 10)}` : "");
  ok("…and the signup fingerprint recorded", row?.signup_fingerprint === `${P}-fp-1`,
    `got ${row?.signup_fingerprint}`);

  console.log("\n── lowercase / spaced / URL-style codes still attribute ──");
  ok("normalizeCode folds case", normalizeCode(" ambattrtest ") === CODE);
  const email2 = `${P}-lower@example.test`;
  const s2 = await doSignup(email2, "ambattrtest", `${P}-fp-2`);
  ok("signup with a lowercase code succeeds", s2.statusCode === 201, `got ${s2.statusCode}`);
  const [ref2] = await sql`
    SELECT ar.ambassador_id FROM ambassador_referrals ar
    JOIN users u ON u.id = ar.user_id WHERE u.email = ${email2}`;
  ok("lowercase code still attributes", ref2?.ambassador_id === amb.id);

  console.log("\n── self-referral is refused ──");
  const selfEmail = `${P}-amb@example.test`; // the ambassador's own address
  const s3 = await doSignup(selfEmail, CODE, `${P}-fp-3`);
  ok("signing up as the ambassador's own email doesn't self-attribute",
    s3.statusCode === 409 || !(await sql`
      SELECT 1 FROM ambassador_referrals ar JOIN users u ON u.id = ar.user_id
      WHERE u.email = ${selfEmail}`).length,
    `status=${s3.statusCode}`);

  console.log("\n── an unknown code doesn't break signup ──");
  const email4 = `${P}-nocode@example.test`;
  const s4 = await doSignup(email4, "NOSUCHCODE123", `${P}-fp-4`);
  ok("signup still succeeds", s4.statusCode === 201, `got ${s4.statusCode}`);
  const orphan = await sql`
    SELECT 1 FROM ambassador_referrals ar JOIN users u ON u.id = ar.user_id WHERE u.email = ${email4}`;
  ok("no attribution row for a bogus code", orphan.length === 0);

  console.log("\n── no code at all ──");
  const email5 = `${P}-plain@example.test`;
  const s5 = await doSignup(email5, undefined, `${P}-fp-5`);
  ok("plain signup succeeds", s5.statusCode === 201, `got ${s5.statusCode}`);

  console.log("\n── attribution is idempotent ──");
  // Re-registering the same unverified email must not double-attribute.
  await doSignup(email, CODE, `${P}-fp-1`);
  const [dupes] = await sql`
    SELECT count(*)::int AS n FROM ambassador_referrals WHERE user_id = ${referee.id}::uuid`;
  ok("still exactly one referral row", dupes.n === 1, `n=${dupes.n}`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

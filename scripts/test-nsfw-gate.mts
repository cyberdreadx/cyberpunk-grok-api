/**
 * NSFW is a paying-customer feature, and the toggle is client state — so the
 * gate has to hold when the client simply omits the sfw param. These call the
 * feed handler directly with hand-made tokens, which is exactly what a
 * bypass attempt looks like.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const mod: any = await import("/home/neon/cyberpunk-grok-api/api/feed.ts");
const feed = mod.default?.default ?? mod.default;

const sql = getDb();
const P = "nsfwgate";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;

const [free] = await sql`
  INSERT INTO users (email, password_hash, email_verified)
  VALUES (${P + "-free@example.test"}, 'x', true) RETURNING id, email`;
// hasPurchased() counts a stripe_customer_id as proof of payment.
const [payer] = await sql`
  INSERT INTO users (email, password_hash, email_verified, stripe_customer_id)
  VALUES (${P + "-payer@example.test"}, 'x', true, ${"cus_" + P}) RETURNING id, email`;

async function getFeed(token: string | null, query: Record<string, string>) {
  const res: any = { statusCode: 0, body: null };
  res.setHeader = () => res; res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; }; res.end = () => res;
  await feed({
    method: "GET",
    query: { view: "posts", sort: "top", ...query },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: {},
  } as any, res);
  const posts = res.body?.posts ?? [];
  return { posts, mature: posts.filter((p: any) => p.isMature).length, allowed: res.body?.nsfwAllowed };
}

const freeTok = signToken({ userId: free.id, email: free.email });
const payTok = signToken({ userId: payer.id, email: payer.email });

console.log("\n── the bypass attempt: just omit sfw ──");
let r = await getFeed(freeTok, {});
ok("free user gets zero mature posts", r.mature === 0, `${r.mature} of ${r.posts.length}`);
ok("…and is told they're not allowed", r.allowed === false, `nsfwAllowed=${r.allowed}`);

console.log("\n── explicitly asking for it doesn't help ──");
r = await getFeed(freeTok, { sfw: "0" });
ok("sfw=0 is ignored for a free user", r.mature === 0, `${r.mature} mature`);

console.log("\n── signed out ──");
r = await getFeed(null, {});
ok("logged-out gets zero mature posts", r.mature === 0, `${r.mature} of ${r.posts.length}`);
ok("…and is not allowed", r.allowed === false);

console.log("\n── paying customer ──");
r = await getFeed(payTok, {});
ok("payer is allowed", r.allowed === true);
ok("payer sees mature posts by default request", r.mature > 0, `${r.mature} of ${r.posts.length}`);

r = await getFeed(payTok, { sfw: "1" });
ok("payer opting out still filters", r.mature === 0, `${r.mature} mature`);

console.log("\n── strict is never widened ──");
r = await getFeed(payTok, { sfw: "strict" });
ok("payer asking for strict still gets strict", r.mature === 0, `${r.mature} mature`);

await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

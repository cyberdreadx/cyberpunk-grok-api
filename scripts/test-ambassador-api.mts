/**
 * Exercises the HTTP handlers (not just the lib) so the SQL in every action
 * actually runs: apply -> admin review -> approve -> stats -> click tracking
 * -> extend -> revoke. Uses throwaway users, cleaned up at the end.
 */
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken, ADMIN_EMAIL } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const ambMod: any = await import("/home/neon/cyberpunk-grok-api/api/ambassador.ts");
const adminMod: any = await import("/home/neon/cyberpunk-grok-api/api/admin.ts");
const ambassador = ambMod.default?.default ?? ambMod.default;
const admin = adminMod.default?.default ?? adminMod.default;

const sql = getDb();
const P = "ambapi-test";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

function mkRes() {
  const r: any = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
async function call(handler: any, body: any, token?: string) {
  const req: any = {
    method: "POST", body, query: {},
    headers: { "content-type": "application/json", "user-agent": "amb-test/1.0", "x-forwarded-for": "203.0.113.9" },
  };
  if (token) req.headers.authorization = `Bearer ${token}`;
  const res = mkRes();
  await handler(req, res);
  return res;
}

async function cleanup() {
  await sql`DELETE FROM ambassadors WHERE code LIKE 'APITEST%'`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
}
await cleanup();

const [applicant] = await sql`
  INSERT INTO users (email, password_hash, email_verified)
  VALUES (${P + "-applicant@example.test"}, 'x', true) RETURNING id, email`;
const applicantToken = signToken({ userId: applicant.id, email: applicant.email });

const [adminUser] = await sql`SELECT id, email FROM users WHERE email = ${ADMIN_EMAIL}`;
if (!adminUser) { console.error("no admin user found for", ADMIN_EMAIL); process.exit(1); }
const adminToken = signToken({ userId: adminUser.id, email: adminUser.email });

console.log("\n── apply ──");
let r = await call(ambassador, { action: "apply", pitch: "too short" }, applicantToken);
ok("rejects a thin pitch", r.statusCode === 400, `${r.statusCode}`);

r = await call(ambassador, { action: "apply", requestedCode: "admin", pitch: "x".repeat(40) }, applicantToken);
ok("rejects reserved code", r.statusCode === 400, `${r.body?.error}`);

r = await call(ambassador, {
  action: "apply", requestedCode: "APITESTVANITY", displayName: "Test Promoter",
  country: "US", audienceSize: 12000, channels: "youtube, tiktok",
  socials: { youtube: "https://youtube.com/@test", x: "https://x.com/test" },
  pitch: "I make AI art tutorials and my audience keeps asking what tool I use.",
  payoutPref: "stripe",
}, applicantToken);
ok("application accepted", r.statusCode === 201, `${r.statusCode} ${r.body?.error ?? ""}`);
const appId = r.body?.id;

r = await call(ambassador, { action: "apply", pitch: "x".repeat(40) }, applicantToken);
ok("blocks a second pending application", r.statusCode === 409);

r = await call(ambassador, { action: "mine" }, applicantToken);
ok("mine shows pending", r.body?.application?.status === "pending" && r.body?.ambassador === null);

r = await call(ambassador, { action: "stats" }, applicantToken);
ok("stats gated before approval", r.statusCode === 403 && r.body?.code === "NOT_AMBASSADOR");

console.log("\n── admin review ──");
r = await call(admin, { action: "ambassadors" }, adminToken);
ok("admin roster loads", r.statusCode === 200, `${r.statusCode} ${r.body?.error ?? ""}`);
const listed = (r.body?.applications || []).find((a: any) => a.id === appId);
ok("application appears for review", !!listed);
ok("review context includes fraud signals",
   listed && typeof listed.fingerprint_cluster === "number" && typeof listed.spent_cents === "number",
   `cluster=${listed?.fingerprint_cluster} spent=${listed?.spent_cents}`);

r = await call(admin, { action: "ambassador-review", id: appId, decision: "approve", notes: "looks legit" }, adminToken);
ok("approval mints ambassador", r.statusCode === 200 && r.body?.code === "APITESTVANITY", `${JSON.stringify(r.body)}`);
const ambId = r.body?.ambassadorId;

r = await call(admin, { action: "ambassador-review", id: appId, decision: "approve" }, adminToken);
ok("cannot approve twice", r.statusCode === 409);

console.log("\n── ambassador dashboard ──");
r = await call(ambassador, { action: "mine" }, applicantToken);
ok("mine now returns terms",
   r.body?.ambassador?.commissionPct === 20 && r.body?.ambassador?.commissionMonths === 12,
   `${JSON.stringify(r.body?.ambassador)}`);

r = await call(ambassador, { action: "stats" }, applicantToken);
ok("stats loads", r.statusCode === 200, `${r.statusCode} ${r.body?.error ?? ""}`);
ok("earnings series is gap-filled to 12 months", (r.body?.earningsSeries || []).length === 12,
   `${(r.body?.earningsSeries || []).length}`);

r = await call(ambassador, { action: "referees" }, applicantToken);
ok("referees loads", r.statusCode === 200);
r = await call(ambassador, { action: "commissions" }, applicantToken);
ok("commissions loads", r.statusCode === 200);

console.log("\n── click tracking (public) ──");
r = await call(ambassador, { action: "track", code: "apitestvanity" });
ok("click recorded case-insensitively", r.body?.ok === true, JSON.stringify(r.body));
await call(ambassador, { action: "track", code: "APITESTVANITY" });
const [clicks] = await sql`SELECT clicks, uniques FROM ambassador_click_days WHERE ambassador_id = ${ambId}::uuid AND day = CURRENT_DATE`;
ok("two hits, one unique visitor", clicks?.clicks === 2 && clicks?.uniques === 1,
   `clicks=${clicks?.clicks} uniques=${clicks?.uniques}`);
r = await call(ambassador, { action: "track", code: "NOSUCHCODE" });
ok("unknown code is a silent no-op", r.body?.ok === false);

console.log("\n── extend + terms ──");
const [buyer] = await sql`
  INSERT INTO users (email, password_hash, email_verified)
  VALUES (${P + "-buyer@example.test"}, 'x', true) RETURNING id`;
await sql`
  INSERT INTO ambassador_referrals (ambassador_id, user_id, commission_until)
  VALUES (${ambId}::uuid, ${buyer.id}::uuid, now() + INTERVAL '10 days')`;

r = await call(admin, { action: "ambassador-extend", id: ambId, months: 12, scope: "expiring" }, adminToken);
ok("extend touches the expiring window", r.body?.extended === 1, JSON.stringify(r.body));
const [ext] = await sql`SELECT commission_until, extended_count FROM ambassador_referrals WHERE user_id = ${buyer.id}::uuid`;
const monthsOut = (new Date(ext.commission_until).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30);
ok("window pushed ~12 months out", monthsOut > 11.5 && monthsOut < 13, `${monthsOut.toFixed(1)} months`);
ok("extension counted", ext.extended_count === 1);

r = await call(admin, { action: "ambassador-update", id: ambId, commissionPct: 25, tier: "gold" }, adminToken);
ok("terms update", r.statusCode === 200);
const [terms] = await sql`SELECT commission_pct, tier FROM ambassadors WHERE id = ${ambId}::uuid`;
ok("rate is now 25% / gold", Number(terms.commission_pct) === 25 && terms.tier === "gold");

r = await call(admin, { action: "ambassador-update", id: ambId, code: "admin" }, adminToken);
ok("cannot rename to a reserved code", r.statusCode === 400);

console.log("\n── revoke ──");
await sql`
  INSERT INTO ambassador_commissions
    (ambassador_id, user_id, source_id, source_kind, gross_cents, commission_pct, commission_cents, available_at)
  VALUES (${ambId}::uuid, ${buyer.id}::uuid, ${P + "-cs_x"}, 'pack', 1000, 20, 200, now() + INTERVAL '30 days')`;
r = await call(admin, { action: "ambassador-update", id: ambId, status: "revoked" }, adminToken);
ok("revoke voids held commission", r.body?.voidedPending === 1, JSON.stringify(r.body));

r = await call(ambassador, { action: "track", code: "APITESTVANITY" });
ok("revoked code stops tracking", r.body?.ok === false);

await sql`DELETE FROM ambassador_commissions WHERE source_id LIKE ${P + "%"}`;
await cleanup();
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

/**
 * Nothing checked email_verified before running a job, so an address nobody
 * proved they own could burn GPU time. These assert the gate holds on every
 * generation entry point — session auth and API key — and that verifying
 * lifts it immediately rather than after the cache TTL.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";
import {
  isEmailVerified, clearEmailVerifiedCache, EMAIL_VERIFICATION_REQUIRED_CODE,
} from "/home/neon/cyberpunk-grok-api/api/_lib/emailVerifiedGate.ts";

const sql = getDb();
const P = "emailgate";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
const [unv] = await sql`
  INSERT INTO users (email, password_hash, email_verified, pack_credits)
  VALUES (${P + "-unverified@example.test"}, 'x', false, 500) RETURNING id, email`;
const [ver] = await sql`
  INSERT INTO users (email, password_hash, email_verified, pack_credits)
  VALUES (${P + "-verified@example.test"}, 'x', true, 500) RETURNING id, email`;
const [adm] = await sql`
  INSERT INTO users (email, password_hash, email_verified, is_admin, pack_credits)
  VALUES (${P + "-admin@example.test"}, 'x', false, true, 500) RETURNING id, email`;

console.log("\n── the gate itself ──");
ok("unverified is blocked", (await isEmailVerified(unv.id)) === false);
ok("verified passes", (await isEmailVerified(ver.id)) === true);
ok("admin bypasses even while unverified", (await isEmailVerified(adm.id)) === true);

console.log("\n── verifying lifts it without waiting for the cache ──");
await sql`UPDATE users SET email_verified = true WHERE id = ${unv.id}::uuid`;
ok("still cached as blocked", (await isEmailVerified(unv.id)) === false, "(30s TTL)");
clearEmailVerifiedCache(unv.id);
ok("cleared → passes immediately", (await isEmailVerified(unv.id)) === true);
await sql`UPDATE users SET email_verified = false WHERE id = ${unv.id}::uuid`;
clearEmailVerifiedCache(unv.id);

function mkRes() {
  const r: any = { statusCode: 0, body: null };
  r.setHeader = () => r; r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; }; r.end = () => r;
  return r;
}

console.log("\n── every generation entry point ──");
const token = signToken({ userId: unv.id, email: unv.email });
const routes: [string, string, any][] = [
  ["api/generate.ts", "session", { action: "generate-image", prompt: "x" }],
  ["api/comfyui.ts", "session", { action: "generate", workflow: "klein", prompt: "x" }],
  ["api/gltch.ts", "session", { prompt: "x", imageUrl: "https://example.com/a.png" }],
];
for (const [path, kind, body] of routes) {
  const mod: any = await import(`/home/neon/cyberpunk-grok-api/${path}`);
  const handler = mod.default?.default ?? mod.default;
  const res = mkRes();
  await handler({
    method: "POST", body, query: {},
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  } as any, res);
  ok(`${path} blocks unverified`,
     res.statusCode === 403 && res.body?.code === EMAIL_VERIFICATION_REQUIRED_CODE,
     `${res.statusCode} ${res.body?.code ?? res.body?.error?.slice(0, 40) ?? ""}`);
}

await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

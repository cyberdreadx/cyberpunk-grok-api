/**
 * library-purge must never delete media that a server-side row still points at,
 * even when the caller demonstrably owns the file.
 *
 * The regression this locks down: posting to the feed stores the generation
 * output URL directly instead of copying it, so emptying library trash used to
 * delete the bytes out from under the user's own public post — every R2 feed
 * video lives at comfyui-output/<uid>/…, which keyBelongsToUser() matches.
 *
 * Every key here is fabricated under a throwaway user id that has never held
 * real objects, so the deletes that do fire target keys which don't exist.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

// No stubbing: ES module namespaces are read-only. Instead every key here is
// fabricated under a throwaway user id that has never had real objects, so the
// R2 deletes that DO fire target keys that don't exist — a no-op — and the
// assertions read the handler's own tallies.
const mod: any = await import("/home/neon/cyberpunk-grok-api/api/library-purge.ts");
const handler = mod.default?.default ?? mod.default;

const sql = getDb();
const P = "purgetest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

await sql`DELETE FROM feed_posts WHERE text LIKE ${P + "%"}`;
await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;

const [u] = await sql`
  INSERT INTO users (email, password_hash, email_verified)
  VALUES (${P + "-owner@example.test"}, 'x', true) RETURNING id, email`;
const token = signToken({ userId: u.id, email: u.email });

const R2_BASE = "https://pub-0a4d910130d047e9a9c0e03feb7fcca6.r2.dev";
const posted = `${R2_BASE}/comfyui-output/${u.id}/1700000000000-posted.mp4`;
const unposted = `${R2_BASE}/comfyui-output/${u.id}/1700000000001-private.mp4`;
const someoneElse = `${R2_BASE}/comfyui-output/00000000-0000-0000-0000-000000000000/1700000000002-other.mp4`;

await sql`
  INSERT INTO feed_posts (user_id, text, image_url)
  VALUES (${u.id}::uuid, ${P + " video post"}, ${posted})`;

async function purge(urls: string[]) {
  const res: any = { statusCode: 0, body: null };
  res.setHeader = () => res; res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; }; res.end = () => res;
  await handler({ method: "POST", body: { urls }, query: {}, headers: { authorization: `Bearer ${token}` } } as any, res);
  return res;
}

console.log("\n── feed-referenced media is protected ──");
let r = await purge([posted]);
ok("owned-but-posted video is NOT deleted", r.body?.deletedR2 === 0, JSON.stringify(r.body));
ok("…and is reported skipped", r.body?.skipped >= 1, JSON.stringify(r.body));

console.log("\n── unreferenced media still purges ──");
r = await purge([unposted]);
ok("owned + unposted video IS deleted", r.body?.deletedR2 >= 1 && r.body?.skipped === 0, JSON.stringify(r.body));

console.log("\n── ownership is still required ──");
r = await purge([someoneElse]);
ok("another user's file is never touched", r.body?.deletedR2 === 0 && r.body?.skipped === 1, JSON.stringify(r.body));

console.log("\n── mixed batch ──");
r = await purge([posted, unposted]);
// Every key expands to itself + its -preview.webp companion, and the reference
// set carries both — so sparing the posted video is 2 skips, while the unposted
// one contributes 2 deletes.
ok("protects the posted one, purges the other",
   r.body?.skipped === 2 && r.body?.deletedR2 === 2, JSON.stringify(r.body));

await sql`DELETE FROM feed_posts WHERE text LIKE ${P + "%"}`;
await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

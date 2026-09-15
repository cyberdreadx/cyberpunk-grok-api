/**
 * The starter grant is claimed per DEVICE and per INBOX, not per account. These
 * lock down the farming cases: a second account on the same device, a replayed
 * verification, deleting the account and re-registering, and — the one farmers
 * actually used — a fresh browser fingerprint with a new +tag on the same inbox.
 */
process.env.RESEND_API_KEY = "";
// No config caching for this suite — the switches are flipped between
// assertions and every read must see the current value.
process.env.FREE_CREDITS_CACHE_TTL_MS = "0";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { grantStarterCredits } from "/home/neon/cyberpunk-grok-api/api/_lib/starterGrant.ts";
// Extensionless on purpose. starterGrant.ts imports "./freeCredits", and under
// tsx an explicit ".ts" specifier resolves to a SEPARATE module instance with
// its own config cache — invalidating that copy leaves the one the code under
// test actually reads untouched, and every assertion sees stale config.
import { invalidateFreeCreditsCache } from "/home/neon/cyberpunk-grok-api/api/_lib/freeCredits";

const sql = getDb();
const P = "startertest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

// Snapshot config so the live switches are restored no matter how this exits.
const [cfgRow] = await sql`SELECT value FROM app_config WHERE key = 'free_credits'`;
const original = cfgRow?.value ?? null;

async function setCfg(patch: any) {
  const merged = { ...(original || {}), ...patch };
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES ('free_credits', ${JSON.stringify(merged)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  invalidateFreeCreditsCache();
}

async function cleanup() {
  await sql`DELETE FROM starter_grants WHERE fingerprint LIKE ${P + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
}
async function mkUser(tag: string, fp: string | null) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified, device_fingerprint, pack_credits)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true, ${fp}, 0) RETURNING id`;
  return u.id as string;
}
/** Stored lowercased like signup does; the grant is handed the raw spelling. */
async function mkUserEmail(fp: string | null, email: string) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified, device_fingerprint, pack_credits)
    VALUES (${email.toLowerCase()}, 'x', true, ${fp}, 0) RETURNING id`;
  return u.id as string;
}
const balance = async (id: string) => {
  const [u] = await sql`SELECT pack_credits FROM users WHERE id = ${id}::uuid`;
  return u?.pack_credits ?? 0;
};

await cleanup();

try {
  console.log("\n── disabled by default ──");
  await setCfg({ starter: false });
  const off = await mkUser("off", `${P}-fp-off`);
  let r = await grantStarterCredits(sql, off, `${P}-fp-off`);
  ok("no grant while the switch is off", !r.granted && r.reason === "disabled");
  ok("balance untouched", (await balance(off)) === 0);

  console.log("\n── enabled: first account on a device ──");
  await setCfg({ starter: true, starterCredits: 15 });
  const fp = `${P}-fp-shared`;
  const a = await mkUser("a", fp);
  r = await grantStarterCredits(sql, a, fp);
  ok("granted", r.granted && r.credits === 15, `${JSON.stringify(r)}`);
  ok("credits landed in pack_credits", (await balance(a)) === 15);

  console.log("\n── replayed verification ──");
  r = await grantStarterCredits(sql, a, fp);
  ok("second call grants nothing", !r.granted && r.reason === "already-claimed", `${JSON.stringify(r)}`);
  ok("balance still 15, not 30", (await balance(a)) === 15);

  console.log("\n── second account, same device ──");
  const b = await mkUser("b", fp);
  r = await grantStarterCredits(sql, b, fp);
  ok("alt account on a claimed device gets nothing", !r.granted && r.reason === "device-claimed", `${JSON.stringify(r)}`);
  ok("alt balance is 0", (await balance(b)) === 0);

  console.log("\n── different device ──");
  const c = await mkUser("c", `${P}-fp-other`);
  r = await grantStarterCredits(sql, c, `${P}-fp-other`);
  ok("a genuinely new device is granted", r.granted && r.credits === 15);

  console.log("\n── delete the account and re-register on the same device ──");
  await sql`DELETE FROM users WHERE id = ${a.toString()}::uuid`;
  const [claimStillThere] = await sql`SELECT user_id, fingerprint FROM starter_grants WHERE fingerprint = ${fp}`;
  ok("claim survives account deletion", !!claimStillThere, `user_id=${claimStillThere?.user_id ?? "null"}`);
  ok("…with the user link dropped, not the row", claimStillThere?.user_id === null);
  const d = await mkUser("d", fp);
  r = await grantStarterCredits(sql, d, fp);
  ok("re-registering on that device gets nothing", !r.granted, `${JSON.stringify(r)}`);
  ok("re-registered balance is 0", (await balance(d)) === 0);

  console.log("\n── configurable size ──");
  await setCfg({ starter: true, starterCredits: 40 });
  const e = await mkUser("e", `${P}-fp-forty`);
  r = await grantStarterCredits(sql, e, `${P}-fp-forty`);
  ok("honours the configured amount", r.granted && r.credits === 40, `${JSON.stringify(r)}`);

  console.log("\n── one grant per inbox, across devices ──");
  await setCfg({ starter: true, starterCredits: 15 });
  const first = `${P}.inbox+first@gmail.com`;
  const i1 = await mkUserEmail(`${P}-fp-inbox-1`, first);
  r = await grantStarterCredits(sql, i1, `${P}-fp-inbox-1`, first);
  ok("first account on an inbox is granted", r.granted, JSON.stringify(r));

  const second = `${P}inbox+second@gmail.com`;
  const i2 = await mkUserEmail(`${P}-fp-inbox-2`, second);
  r = await grantStarterCredits(sql, i2, `${P}-fp-inbox-2`, second);
  ok("same inbox on a new device with a new +tag gets nothing", !r.granted && r.reason === "inbox-claimed", JSON.stringify(r));
  ok("…and its balance stays 0", (await balance(i2)) === 0);

  const third = `${P.toUpperCase()}.IN.BOX@googlemail.com`;
  const i3 = await mkUserEmail(`${P}-fp-inbox-3`, third);
  r = await grantStarterCredits(sql, i3, `${P}-fp-inbox-3`, third);
  ok("dots, case and googlemail.com all resolve to the same inbox", !r.granted && r.reason === "inbox-claimed", JSON.stringify(r));

  const other = `${P}-different@example.test`;
  const i4 = await mkUserEmail(`${P}-fp-inbox-4`, other);
  r = await grantStarterCredits(sql, i4, `${P}-fp-inbox-4`, other);
  ok("a genuinely different inbox on a new device is granted", r.granted, JSON.stringify(r));

  console.log("\n── dots only collapse where the provider ignores them ──");
  const d1 = await mkUserEmail(`${P}-fp-dot-1`, `${P}.first.last@example.test`);
  r = await grantStarterCredits(sql, d1, `${P}-fp-dot-1`, `${P}.first.last@example.test`);
  ok("first.last@ on a non-Gmail domain is granted", r.granted, JSON.stringify(r));
  const d2 = await mkUserEmail(`${P}-fp-dot-2`, `${P}firstlast@example.test`);
  r = await grantStarterCredits(sql, d2, `${P}-fp-dot-2`, `${P}firstlast@example.test`);
  ok("firstlast@ there is a different person and is granted too", r.granted, JSON.stringify(r));

  console.log("\n── no usable email falls back to the device key alone ──");
  const n1 = await mkUser("nomail1", `${P}-fp-nomail-1`);
  r = await grantStarterCredits(sql, n1, `${P}-fp-nomail-1`, "not-an-email");
  ok("an unparseable address does not block the grant", r.granted, JSON.stringify(r));
  const [stored] = await sql`SELECT mailbox FROM starter_grants WHERE user_id = ${n1}::uuid`;
  ok("…and is stored as NULL, never an empty string", stored?.mailbox === null, `mailbox=${JSON.stringify(stored?.mailbox)}`);
  const n2 = await mkUser("nomail2", `${P}-fp-nomail-2`);
  r = await grantStarterCredits(sql, n2, `${P}-fp-nomail-2`, "");
  ok("two unusable addresses never collide with each other", r.granted, JSON.stringify(r));
} finally {
  // Always put the live config back.
  if (original) {
    await sql`UPDATE app_config SET value = ${JSON.stringify(original)}::jsonb WHERE key = 'free_credits'`;
  } else {
    await sql`DELETE FROM app_config WHERE key = 'free_credits'`;
  }
  invalidateFreeCreditsCache();
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

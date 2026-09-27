/**
 * Referral activation rewards — every guard.
 *
 * A signup-triggered referral grant existed once and was retired because farms
 * minted accounts for it. This one pays on activation instead, and the rules
 * below are the reason it can be turned on again. Each test builds the exact
 * shape a farm used in a previous wave.
 *
 *   node --env-file=.env --import tsx scripts/test-referral-rewards.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { readReferralConfig, pendingActivations, payActivation } from "/home/neon/cyberpunk-grok-api/api/_lib/referral-rewards.ts";

const sql = getDb();
const P = "reftest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

const cfg = { ...(await readReferralConfig(sql)), enabled: true, dryRun: false, since: null };

async function mkUser(tag: string, o: { fp?: string | null; ageHours?: number; verified?: boolean } = {}) {
  const [u] = (await sql`
    INSERT INTO users (email, password_hash, email_verified, device_fingerprint, created_at)
    VALUES (${`${P}-${tag}@example.test`}, 'x', ${o.verified ?? true}, ${o.fp === null ? null : (o.fp ?? `fp-${tag}`)},
            now() - (${o.ageHours ?? 48} || ' hours')::interval)
    RETURNING id`) as any[];
  return String(u.id);
}
async function mkRef(referrer: string, referee: string, verified = true) {
  const [r] = (await sql`
    INSERT INTO referrals (referrer_id, referee_id, referee_verified, referee_signup_reward, created_at)
    VALUES (${referrer}::uuid, ${referee}::uuid, ${verified}, false, now() - interval '3 days')
    RETURNING id`) as any[];
  return String(r.id);
}
const gen = (id: string, n: number) => Promise.all(Array.from({ length: n }, () =>
  sql`INSERT INTO usage_log (user_id, mode, credits_used, created_at) VALUES (${id}::uuid, 'comfy-klein', 3, now() - interval '1 day')`));

async function cleanup() {
  const ids = ((await sql`SELECT id FROM users WHERE email LIKE ${P + "-%"}`) as any[]).map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM referrals WHERE referrer_id = ANY(${ids}::uuid[]) OR referee_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM usage_log WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM credit_ledger WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM user_bans WHERE user_id = ANY(${ids}::uuid[])`;
  }
  await sql`DELETE FROM users WHERE email LIKE ${P + "-%"}`;
}
const eligibleIds = async () => (await pendingActivations(sql, cfg, 500)).map((a) => a.id);

await cleanup();
try {
  console.log(`config: +${cfg.referrerCredits}/+${cfg.refereeCredits} credits, ${cfg.minGenerations} generations, ${cfg.minAgeHours}h old\n`);
  console.log("── a real referral ──");
  const referrer = await mkUser("referrer");
  const good = await mkUser("good");
  await gen(good, 3);
  const goodRef = await mkRef(referrer, good);
  ok("verified, aged, 3 generations, own device → pays", (await eligibleIds()).includes(goodRef));

  console.log("\n── the shapes farms used ──");
  const selfRef = await mkUser("self", { fp: "fp-referrer" });
  await gen(selfRef, 5);
  const selfId = await mkRef(referrer, selfRef);
  ok("same device as the referrer (self-referral) → refused", !(await eligibleIds()).includes(selfId));

  const ring1 = await mkUser("ring1", { fp: "fp-ring" });
  const ring2 = await mkUser("ring2", { fp: "fp-ring" });
  await gen(ring1, 4); await gen(ring2, 4);
  const r1 = await mkRef(referrer, ring1);
  const r2 = await mkRef(referrer, ring2);
  const ringEligible = (await eligibleIds()).filter((id) => id === r1 || id === r2);
  ok("two referees on ONE device (a ring) → both refused", ringEligible.length === 0);

  const noFp = await mkUser("nofp", { fp: null });
  await gen(noFp, 4);
  const noFpId = await mkRef(referrer, noFp);
  ok("no device fingerprint at all → refused", !(await eligibleIds()).includes(noFpId));

  const fresh = await mkUser("fresh", { ageHours: 2 });
  await gen(fresh, 5);
  const freshId = await mkRef(referrer, fresh);
  ok("account created 2 hours ago → refused (burst pattern)", !(await eligibleIds()).includes(freshId));

  const idle = await mkUser("idle");
  await gen(idle, 1);
  const idleId = await mkRef(referrer, idle);
  ok("signed up but barely used it → refused", !(await eligibleIds()).includes(idleId));

  const unver = await mkUser("unverified", { verified: false });
  await gen(unver, 5);
  const unverId = await mkRef(referrer, unver, false);
  ok("unverified email → refused", !(await eligibleIds()).includes(unverId));

  const bannedUser = await mkUser("banned");
  await gen(bannedUser, 5);
  const bannedId = await mkRef(referrer, bannedUser);
  await sql`INSERT INTO user_bans (user_id, reason) VALUES (${bannedUser}::uuid, 'referral test')`;
  ok("banned referee → refused", !(await eligibleIds()).includes(bannedId));

  console.log("\n── paying it ──");
  const before = (await sql`SELECT COALESCE(pack_credits,0)::int c FROM users WHERE id = ${referrer}::uuid`) as any[];
  const target = (await pendingActivations(sql, cfg, 500)).find((a) => a.id === goodRef)!;
  ok("pays once", await payActivation(sql, cfg, target));
  ok("refuses to pay the same referral twice", !(await payActivation(sql, cfg, target)));
  const after = (await sql`SELECT COALESCE(pack_credits,0)::int c FROM users WHERE id = ${referrer}::uuid`) as any[];
  ok("referrer actually received the credits", after[0].c - before[0].c === cfg.referrerCredits, `${before[0].c} → ${after[0].c}`);
  const [refeeCr] = (await sql`SELECT COALESCE(pack_credits,0)::int c FROM users WHERE id = ${good}::uuid`) as any[];
  ok("referee received theirs too", refeeCr.c === cfg.refereeCredits);
  const [led] = (await sql`SELECT COUNT(*)::int n FROM credit_ledger WHERE ref_key = ${goodRef}`) as any[];
  ok("both grants are in the audit ledger", led.n === 2);
  ok("it disappears from the pending list", !(await eligibleIds()).includes(goodRef));

  console.log("\n── the weekly cap ──");
  const capped = [];
  for (let i = 0; i < cfg.weeklyCapPerReferrer + 2; i++) {
    const u = await mkUser(`cap${i}`, { fp: `fp-cap${i}` });
    await gen(u, 4);
    capped.push(await mkRef(referrer, u));
  }
  let payments = 0;
  for (const a of await pendingActivations(sql, cfg, 500)) {
    if (capped.includes(a.id) && await payActivation(sql, cfg, a)) payments++;
  }
  const remaining = (await eligibleIds()).filter((id) => capped.includes(id)).length;
  ok(`stops at ${cfg.weeklyCapPerReferrer} rewards per week`, payments <= cfg.weeklyCapPerReferrer, `paid ${payments}, ${remaining} left waiting`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * Lifecycle email guardrails. This cron runs every 15 minutes forever, so the
 * cost of a bad rule is not one bad blast — it is one every quarter of an hour.
 * Every exclusion is pinned here.
 *
 *   node --env-file=.env --import tsx scripts/test-lifecycle.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import {
  filterEligible, claimSend, releaseClaim, renderLifecycleEmail,
  emptyTankCandidates, winbackCandidates, readLifecycleConfig,
} from "/home/neon/cyberpunk-grok-api/api/_lib/lifecycle.ts";

const sql = getDb();
const P = "lifecycletest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

async function mk(tag: string, o: { verified?: boolean; tier?: string | null; credits?: number } = {}) {
  const [u] = (await sql`
    INSERT INTO users (email, password_hash, email_verified, subscription_tier, pack_credits)
    VALUES (${`${P}-${tag}@example.test`}, 'x', ${o.verified ?? true}, ${o.tier ?? null}, ${o.credits ?? 0})
    RETURNING id, email`) as any[];
  return { id: String(u.id), email: String(u.email) };
}
const gen = (id: string, daysAgo: number) => sql`
  INSERT INTO usage_log (user_id, mode, credits_used, created_at)
  VALUES (${id}::uuid, 'comfy-klein', 3, now() - (${daysAgo} || ' days')::interval)`;
const pay = (id: string, daysAgo: number, type = "pack") => sql`
  INSERT INTO transactions (user_id, credits, amount_cents, type, stripe_session_id, created_at)
  VALUES (${id}::uuid, 240, 1999, ${type}, ${"sess_" + Math.random().toString(36).slice(2)}, now() - (${daysAgo} || ' days')::interval)`;

async function cleanup() {
  const ids = ((await sql`SELECT id FROM users WHERE email LIKE ${P + "-%"}`) as any[]).map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM lifecycle_sends WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM usage_log WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM transactions WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM user_bans WHERE user_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM notification_prefs WHERE user_id = ANY(${ids}::uuid[])`;
  }
  await sql`DELETE FROM email_suppressions WHERE email LIKE ${P + "-%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "-%"}`;
}

await cleanup();
try {
  console.log("── the switch ──");
  // Test the DEFAULT, not whatever production happens to be set to today: with no
  // config row at all the engine must refuse to send. (Asserting the live row is
  // off would fail the moment the owner legitimately turns it on — which is what
  // happened on 2026-09-23.)
  const noRow = (() => Promise.resolve([])) as any;
  const fallback = await readLifecycleConfig(noRow);
  ok("with no config at all it is off", fallback.enabled === false);
  ok("and dry run is the fallback", fallback.dryRun === true);
  const live = await readLifecycleConfig(sql);
  console.log(`  note  live config: enabled=${live.enabled} dryRun=${live.dryRun} maxPerRun=${live.maxPerRun}`);

  console.log("\n── who may be mailed ──");
  const good = await mk("good");
  const unverified = await mk("unverified", { verified: false });
  const optedOut = await mk("optedout");
  const banned = await mk("banned");
  const suppressed = await mk("suppressed");
  const justPaid = await mk("justpaid");
  const mailedRecently = await mk("mailedrecently");
  await sql`INSERT INTO notification_prefs (user_id, email_enabled) VALUES (${optedOut.id}::uuid, false)`;
  await sql`INSERT INTO user_bans (user_id, reason) VALUES (${banned.id}::uuid, 'lifecycle test')`;
  await sql`INSERT INTO email_suppressions (email, reason) VALUES (lower(${suppressed.email}), 'bounced')`;
  await pay(justPaid.id, 0);
  await sql`INSERT INTO lifecycle_sends (flow, user_id, ref, email, sent_at)
            VALUES ('winback', ${mailedRecently.id}::uuid, '', ${mailedRecently.email}, now() - interval '2 days')`;

  const all = [good, unverified, optedOut, banned, suppressed, justPaid, mailedRecently];
  const eligible = await filterEligible(sql, "empty_tank", all);
  const ids = eligible.map((c) => c.id);
  ok("the ordinary user is eligible", ids.includes(good.id));
  ok("unverified is excluded", !ids.includes(unverified.id));
  ok("opted out is excluded", !ids.includes(optedOut.id));
  ok("banned is excluded", !ids.includes(banned.id));
  ok("bounced/suppressed is excluded", !ids.includes(suppressed.id));
  ok("someone who paid today is excluded", !ids.includes(justPaid.id));
  ok("someone mailed 2 days ago is excluded (weekly cap)", !ids.includes(mailedRecently.id));

  console.log("\n── the follow-up in a sequence ──");
  const seq = await mk("sequence");
  await sql`INSERT INTO lifecycle_sends (flow, user_id, ref, email, sent_at)
            VALUES ('cart_recovery_1', ${seq.id}::uuid, 'cs_test_1', ${seq.email}, now() - interval '1 day')`;
  const blocked = await filterEligible(sql, "cart_recovery_2", [{ ...seq, ref: "cs_test_1" }]);
  ok("weekly cap would block the second email", blocked.length === 0);
  const allowed = await filterEligible(sql, "cart_recovery_2", [{ ...seq, ref: "cs_test_1" }], { skipGlobalCooldown: true });
  ok("the sequence exemption lets it through", allowed.length === 1);

  console.log("\n── two carts, one person, one email ──");
  const twoCarts = await mk("twocarts");
  const batch = [
    { ...twoCarts, ref: "cs_cart_a" },
    { ...twoCarts, ref: "cs_cart_b" },
  ];
  const deduped = await filterEligible(sql, "cart_recovery_1", batch);
  ok("a batch with two carts for one person yields one send", deduped.length === 1, `got ${deduped.length}`);

  console.log("\n── a send can only happen once ──");
  const c = { ...good, ref: "cs_once" };
  ok("first claim wins", await claimSend(sql, "cart_recovery_1", c));
  ok("second claim is refused", !(await claimSend(sql, "cart_recovery_1", c)));
  await releaseClaim(sql, "cart_recovery_1", c);
  ok("a failed send releases the claim for a retry", await claimSend(sql, "cart_recovery_1", c));
  await releaseClaim(sql, "cart_recovery_1", c);

  console.log("\n── flow cooldowns ──");
  await sql`INSERT INTO lifecycle_sends (flow, user_id, ref, email, sent_at)
            VALUES ('empty_tank', ${good.id}::uuid, '', ${good.email}, now() - interval '20 days')`;
  const cooled = await filterEligible(sql, "empty_tank", [good]);
  ok("empty tank waits 30 days before asking again", cooled.length === 0);
  await sql`DELETE FROM lifecycle_sends WHERE user_id = ${good.id}::uuid`;

  console.log("\n── who the flows pick ──");
  const empty = await mk("emptytank", { credits: 0 });
  const hasCredits = await mk("hascredits", { credits: 500 });
  const subscriber = await mk("subscriber", { tier: "basic", credits: 0 });
  for (const u of [empty, hasCredits, subscriber]) await gen(u.id, 1);
  const tank = (await emptyTankCandidates(sql, 500)).map((x) => x.id);
  ok("picks someone at zero who is still creating", tank.includes(empty.id));
  ok("skips someone who still has credits", !tank.includes(hasCredits.id));
  ok("skips a subscriber (their credits refill daily)", !tank.includes(subscriber.id));

  const lapsed = await mk("lapsed", { credits: 120 });
  await pay(lapsed.id, 45); await gen(lapsed.id, 40);
  const activeBuyer = await mk("activebuyer");
  await pay(activeBuyer.id, 45); await gen(activeBuyer.id, 2);
  const neverPaid = await mk("neverpaid");
  await gen(neverPaid.id, 40);
  const wb = (await winbackCandidates(sql, 500)).map((x) => x.id);
  ok("picks a past customer who went quiet", wb.includes(lapsed.id));
  ok("skips a customer who is still active", !wb.includes(activeBuyer.id));
  ok("skips someone who never paid", !wb.includes(neverPaid.id));

  console.log("\n── every email carries its exits ──");
  const body = renderLifecycleEmail("<div>hello</div>", good.id);
  ok("unsubscribe link present", /Unsubscribe from these emails/.test(body));
  ok("postal address present", body.includes((process.env.MAIL_POSTAL_ADDRESS || "").split(",")[0]));
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

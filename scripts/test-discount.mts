/**
 * Subscription discount resolution.
 *
 * The bug: `(row?.pct ?? 0) || TIER_DISCOUNT_PCT[tier]` treated an explicit 0
 * as "unset" and fell through to the retired 15/30/50/70% ladder. Every
 * subscriber had been migrated to 0 — credits instead of a discount — so all
 * 117 kept receiving both, and no admin edit could ever remove a discount
 * because writing 0 was indistinguishable from writing nothing.
 *
 * users.subscription_discount_pct is `integer NOT NULL DEFAULT 0`, which is
 * asserted below: it's what makes the column a complete source of truth and
 * the old fallback table dead code.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { getUserDiscountPct, applyDiscount } from "/home/neon/cyberpunk-grok-api/api/_lib/discount.ts";

const sql = getDb();
const P = "disctest";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const cleanup = () => sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;

// A distinct user per case: getUserDiscountPct caches for 30s, so reusing a
// row would just replay the first answer.
async function mkUser(tag: string, tier: string | null, pct: number) {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified, subscription_tier, subscription_discount_pct)
    VALUES (${`${P}-${tag}@example.test`}, 'x', true, ${tier}, ${pct}) RETURNING id`;
  return u.id as string;
}

await cleanup();

try {
  console.log("\n── the column really is the whole story ──");
  const [col] = await sql`
    SELECT is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'subscription_discount_pct'`;
  ok("subscription_discount_pct is NOT NULL", col?.is_nullable === "NO",
    "so a tier fallback could never legitimately fire");
  ok("…and defaults to 0", String(col?.column_default) === "0");

  console.log("\n── explicit 0 means no discount (the regression) ──");
  for (const [tier, legacy] of [["basic", 15], ["premium", 30], ["pro", 50], ["elite", 70]] as const) {
    const id = await mkUser(`zero-${tier}`, tier, 0);
    const pct = await getUserDiscountPct(id);
    ok(`${tier} @ 0 → 0%`, pct === 0, `got ${pct}%; the retired ladder said ${legacy}%`);
  }

  console.log("\n── an explicit positive value is honoured ──");
  ok("basic @ 42 → 42%", (await getUserDiscountPct(await mkUser("custom", "basic", 42))) === 42);
  ok("elite @ 10 → 10%, not the old 70%", (await getUserDiscountPct(await mkUser("lower", "elite", 10))) === 10);
  ok("premium-yearly @ 30 → 30%", (await getUserDiscountPct(await mkUser("yearly", "premium-yearly", 30))) === 30);

  console.log("\n── no subscription ──");
  ok("no tier, 0 pct → 0%", (await getUserDiscountPct(await mkUser("none", null, 0))) === 0);
  ok("a tier alone grants nothing", (await getUserDiscountPct(await mkUser("tieronly", "pro", 0))) === 0);
  ok("unknown user → 0%", (await getUserDiscountPct("00000000-0000-0000-0000-000000000000")) === 0);

  console.log("\n── clamping ──");
  ok("99 clamps to 95", (await getUserDiscountPct(await mkUser("huge", "basic", 99))) === 95);
  ok("negative clamps to 0", (await getUserDiscountPct(await mkUser("neg", "basic", -5))) === 0);

  console.log("\n── what this means at the till (WAN lists at 15 credits) ──");
  ok("0% → 15 credits", applyDiscount(15, 0) === 15);
  ok("30% → 11 credits (what premium was paying)", applyDiscount(15, 30) === 11);
  ok("50% → 8 credits (what pro was paying)", applyDiscount(15, 50) === 8);
  // round(15 × 0.30) = 5. The 4-credit WAN jobs in production came from elite
  // stacked multiplicatively with an XRGE holder tier, not from 70% alone.
  ok("70% → 5 credits", applyDiscount(15, 70) === 5);
  ok("~73% combined → 4 credits (the elite + holder stack)", applyDiscount(15, 73) === 4);
  ok("a paid action never drops below 1 credit", applyDiscount(1, 95) === 1);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

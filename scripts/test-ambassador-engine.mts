/**
 * End-to-end exercise of the ambassador money path against the live DB using
 * throwaway users, cleaned up at the end. Verifies: attribution, accrual,
 * idempotency under webhook retry, hold + release into cash_balance,
 * clawback reversal, expiry, and self-referral disqualification.
 */
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import {
  attributeSignup,
  accrueCommission,
  clawbackCommission,
  releaseMaturedCommissions,
  findAmbassadorByCode,
  validateCode,
  isCodeAvailable,
} from "/home/neon/cyberpunk-grok-api/api/_lib/ambassador.ts";

const sql = getDb();
const stamp = process.argv[2] || "t1";
const P = `ambtest-${stamp}`;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

async function cleanup() {
  await sql`DELETE FROM ambassador_commissions WHERE source_id LIKE ${P + "%"}`;
  await sql`DELETE FROM ambassadors WHERE code LIKE ${"AMBTEST%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
}

await cleanup();

// ── Fixtures ────────────────────────────────────────────────────────────
const [promoter] = await sql`
  INSERT INTO users (email, password_hash, email_verified, device_fingerprint)
  VALUES (${P + "-promoter@example.test"}, 'x', true, ${P + "-fp-promoter"})
  RETURNING id`;
const [buyer] = await sql`
  INSERT INTO users (email, password_hash, email_verified, device_fingerprint)
  VALUES (${P + "-buyer@example.test"}, 'x', true, ${P + "-fp-buyer"})
  RETURNING id`;
const [alt] = await sql`
  INSERT INTO users (email, password_hash, email_verified, device_fingerprint)
  VALUES (${P + "-alt@example.test"}, 'x', true, ${P + "-fp-promoter"})
  RETURNING id`;
const [expired] = await sql`
  INSERT INTO users (email, password_hash, email_verified)
  VALUES (${P + "-expired@example.test"}, 'x', true)
  RETURNING id`;

const [amb] = await sql`
  INSERT INTO ambassadors (user_id, code, commission_pct, commission_months, hold_days)
  VALUES (${promoter.id}::uuid, 'AMBTESTCODE', 20.00, 12, 30)
  RETURNING id`;

console.log("\n── code validation ──");
ok("rejects reserved code", validateCode("admin") !== null);
ok("rejects short code", validateCode("ab") !== null);
ok("accepts good code", validateCode("neon_king-9") === null);
ok("taken code unavailable", !(await isCodeAvailable(sql, "AMBTESTCODE")));

console.log("\n── code lookup ──");
const found = await findAmbassadorByCode(sql, "ambtestcode");
ok("case-insensitive lookup", found?.ambassadorId === amb.id);
await sql`UPDATE ambassadors SET status = 'paused' WHERE id = ${amb.id}::uuid`;
ok("paused ambassador not resolvable", (await findAmbassadorByCode(sql, "AMBTESTCODE")) === null);
await sql`UPDATE ambassadors SET status = 'active' WHERE id = ${amb.id}::uuid`;

console.log("\n── attribution ──");
await attributeSignup(sql, { ambassadorId: amb.id, ambassadorUserId: promoter.id, userId: buyer.id, fingerprint: P + "-fp-buyer" });
await attributeSignup(sql, { ambassadorId: amb.id, ambassadorUserId: promoter.id, userId: buyer.id, fingerprint: P + "-fp-buyer" });
const refRows = await sql`SELECT * FROM ambassador_referrals WHERE user_id = ${buyer.id}::uuid`;
ok("attribution is idempotent", refRows.length === 1);
ok("commission window set ~12 months", !!refRows[0]?.commission_until);

await attributeSignup(sql, { ambassadorId: amb.id, ambassadorUserId: promoter.id, userId: alt.id, fingerprint: P + "-fp-promoter" });
const [altRef] = await sql`SELECT disqualified, disqualified_reason FROM ambassador_referrals WHERE user_id = ${alt.id}::uuid`;
ok("same-fingerprint alt disqualified", altRef?.disqualified === true, `(${altRef?.disqualified_reason})`);

await attributeSignup(sql, { ambassadorId: amb.id, ambassadorUserId: promoter.id, userId: promoter.id, fingerprint: null });
const [selfRef] = await sql`SELECT disqualified, disqualified_reason FROM ambassador_referrals WHERE user_id = ${promoter.id}::uuid`;
ok("self-referral disqualified", selfRef?.disqualified === true, `(${selfRef?.disqualified_reason})`);

await attributeSignup(sql, { ambassadorId: amb.id, ambassadorUserId: promoter.id, userId: expired.id, fingerprint: null });
await sql`UPDATE ambassador_referrals SET commission_until = now() - INTERVAL '1 day' WHERE user_id = ${expired.id}::uuid`;

console.log("\n── accrual ──");
const a1 = await accrueCommission(sql, { userId: buyer.id, sourceId: P + "-cs_1", sourceKind: "pack", grossCents: 2000, paymentIntent: P + "-pi_1" });
ok("20% of $20.00 = $4.00", a1?.commissionCents === 400, `got ${a1?.commissionCents}`);

const a1retry = await accrueCommission(sql, { userId: buyer.id, sourceId: P + "-cs_1", sourceKind: "pack", grossCents: 2000, paymentIntent: P + "-pi_1" });
ok("webhook retry books nothing", a1retry === null);

const [refAfter] = await sql`SELECT gross_cents, commission_cents, first_paid_at FROM ambassador_referrals WHERE user_id = ${buyer.id}::uuid`;
ok("rollup counted once", Number(refAfter.gross_cents) === 2000 && Number(refAfter.commission_cents) === 400,
   `gross=${refAfter.gross_cents} comm=${refAfter.commission_cents}`);
ok("first_paid_at stamped", !!refAfter.first_paid_at);

ok("disqualified alt earns nothing",
   (await accrueCommission(sql, { userId: alt.id, sourceId: P + "-cs_alt", sourceKind: "pack", grossCents: 5000 })) === null);
ok("expired window earns nothing",
   (await accrueCommission(sql, { userId: expired.id, sourceId: P + "-cs_exp", sourceKind: "subscription", grossCents: 5000 })) === null);

await sql`UPDATE ambassadors SET status = 'paused' WHERE id = ${amb.id}::uuid`;
ok("paused ambassador earns nothing",
   (await accrueCommission(sql, { userId: buyer.id, sourceId: P + "-cs_paused", sourceKind: "pack", grossCents: 5000 })) === null);
await sql`UPDATE ambassadors SET status = 'active' WHERE id = ${amb.id}::uuid`;

console.log("\n── hold + release ──");
const early = await releaseMaturedCommissions(sql, 500);
const [heldBal] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${promoter.id}::uuid`;
ok("nothing releases inside the hold window", heldBal.cash_balance_cents === 0, `bal=${heldBal.cash_balance_cents}`);

await sql`UPDATE ambassador_commissions SET available_at = now() - INTERVAL '1 hour' WHERE source_id = ${P + "-cs_1"}`;
const rel = await releaseMaturedCommissions(sql, 500);
const [paidBal] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${promoter.id}::uuid`;
ok("matured commission lands in cash balance", paidBal.cash_balance_cents === 400, `bal=${paidBal.cash_balance_cents}`);
ok("release reported", rel.released >= 1 && rel.releasedCents >= 400, `${rel.released} rows / ${rel.releasedCents}c`);

const rel2 = await releaseMaturedCommissions(sql, 500);
const [dblBal] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${promoter.id}::uuid`;
ok("second release pass pays nothing twice", dblBal.cash_balance_cents === 400, `bal=${dblBal.cash_balance_cents}`);

console.log("\n── clawback ──");
const cb = await clawbackCommission(sql, { paymentIntent: P + "-pi_1", reason: "test refund" });
const [cbBal] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${promoter.id}::uuid`;
ok("clawback found released row", cb?.wasReleased === true && cb?.commissionCents === 400);
ok("cash balance debited back to zero", cbBal.cash_balance_cents === 0, `bal=${cbBal.cash_balance_cents}`);
const [refUnbumped] = await sql`SELECT gross_cents, commission_cents FROM ambassador_referrals WHERE user_id = ${buyer.id}::uuid`;
ok("referral rollup reversed", Number(refUnbumped.gross_cents) === 0 && Number(refUnbumped.commission_cents) === 0);
ok("double clawback is a no-op", (await clawbackCommission(sql, { paymentIntent: P + "-pi_1", reason: "again" })) === null);

console.log("\n── pending clawback (never released) ──");
const a2 = await accrueCommission(sql, { userId: buyer.id, sourceId: P + "-cs_2", sourceKind: "subscription", grossCents: 1000, paymentIntent: P + "-pi_2" });
const cb2 = await clawbackCommission(sql, { paymentIntent: P + "-pi_2", reason: "test refund on hold" });
const [pendBal] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${promoter.id}::uuid`;
ok("held commission voids without touching balance", cb2?.wasReleased === false && pendBal.cash_balance_cents === 0,
   `accrued=${a2?.commissionCents} bal=${pendBal.cash_balance_cents}`);

console.log("\n── revoked ambassador ──");
const a3 = await accrueCommission(sql, { userId: buyer.id, sourceId: P + "-cs_3", sourceKind: "pack", grossCents: 3000, paymentIntent: P + "-pi_3" });
await sql`UPDATE ambassador_commissions SET available_at = now() - INTERVAL '1 hour' WHERE source_id = ${P + "-cs_3"}`;
await sql`UPDATE ambassadors SET status = 'revoked' WHERE id = ${amb.id}::uuid`;
const rel3 = await releaseMaturedCommissions(sql, 500);
const [revBal] = await sql`SELECT cash_balance_cents FROM users WHERE id = ${promoter.id}::uuid`;
ok("revoked ambassador is voided, not paid", rel3.voided >= 1 && revBal.cash_balance_cents === 0,
   `voided=${rel3.voided} bal=${revBal.cash_balance_cents}`);

await cleanup();
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

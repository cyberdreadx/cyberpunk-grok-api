/**
 * Take back credits paid for social-proof claims that provably didn't link to us.
 *
 * Only acts on claims scripts/verify-share-proofs.mts has actually READ and found
 * pointing somewhere else. Anything it could not read — deleted, private,
 * rate-limited — is left alone: an unverifiable claim is not evidence of
 * anything, and this is people's balances.
 *
 * Reddit claims are untouched. Reddit blocks this server, so no Reddit claim has
 * been verified either way, and 63,600 credits cannot be clawed back on a hunch.
 *
 * Never pushes anyone negative: the deduction is capped at the balance they
 * still hold. Someone who already spent it keeps what they spent — chasing that
 * would mean invalidating generations they have already received.
 *
 *   node --env-file=.env --import tsx scripts/clawback-share-proofs.mts          # dry run
 *   node --env-file=.env --import tsx scripts/clawback-share-proofs.mts --apply
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { logCreditGrant } from "/home/neon/cyberpunk-grok-api/api/_lib/credit-ledger.ts";

const APPLY = process.argv.includes("--apply");
const PER_CLAIM = 10; // what the X mission paid
const sql = getDb();

const offenders = (await sql`
  SELECT v.user_id, u.email,
    COUNT(*)::int bad_claims,
    COALESCE(u.daily_credits,0) + COALESCE(u.sub_credits,0) + COALESCE(u.pack_credits,0) AS balance,
    EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = v.user_id AND t.amount_cents > 0) AS has_paid
  FROM share_proof_verdicts v
  JOIN users u ON u.id = v.user_id
  WHERE v.links_to_us = false
    AND NOT EXISTS (
      SELECT 1 FROM credit_ledger cl
      WHERE cl.user_id = v.user_id AND cl.source = 'share_proof_clawback'
    )
  GROUP BY v.user_id, u.email, u.daily_credits, u.sub_credits, u.pack_credits
  ORDER BY 3 DESC`) as any[];

let owed = 0, recoverable = 0;
for (const o of offenders) {
  const claim = o.bad_claims * PER_CLAIM;
  owed += claim;
  recoverable += Math.min(claim, Number(o.balance));
}
console.log(`${offenders.length} people submitted claims that provably link elsewhere`);
console.log(`  credits paid for those claims: ${owed}`);
console.log(`  recoverable from current balances: ${recoverable}`);
console.log(`  (the difference is already spent — not chased)\n`);
console.log("  bad  paid-back  balance  customer?  email");
for (const o of offenders.slice(0, 15)) {
  const take = Math.min(o.bad_claims * PER_CLAIM, Number(o.balance));
  console.log(`  ${String(o.bad_claims).padStart(3)} ${String(take).padStart(10)} ${String(o.balance).padStart(8)}  ${o.has_paid ? "yes      " : "no       "}  ${o.email}`);
}
if (offenders.length > 15) console.log(`  … and ${offenders.length - 15} more`);

if (!APPLY) { console.log("\n(dry run — pass --apply to deduct)"); process.exit(0); }

let done = 0, taken = 0;
for (const o of offenders) {
  const take = Math.min(o.bad_claims * PER_CLAIM, Number(o.balance));
  if (take <= 0) continue;
  // Take from pack credits first, then sub, then daily — same order the app spends.
  await sql`
    UPDATE users SET
      pack_credits  = GREATEST(0, COALESCE(pack_credits,0)  - ${take}),
      sub_credits   = GREATEST(0, COALESCE(sub_credits,0)   - GREATEST(0, ${take} - COALESCE(pack_credits,0))),
      daily_credits = GREATEST(0, COALESCE(daily_credits,0) - GREATEST(0, ${take} - COALESCE(pack_credits,0) - COALESCE(sub_credits,0)))
    WHERE id = ${o.user_id}::uuid`;
  await logCreditGrant(sql, String(o.user_id), -take, "share_proof_clawback", `${o.bad_claims} unverified claims`);
  done++; taken += take;
}
console.log(`\ndeducted ${taken} credits from ${done} accounts`);

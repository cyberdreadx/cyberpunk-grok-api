/**
 * Goodwill credit for holder-tier perks that were promised and never delivered.
 *
 * @kaoskaido reached Operative on 2026-07-03 and reported the perks dead for
 * 65 days. They were right on every point: the daily-credit cron has been
 * short-circuiting on app_config.free_credits.daily = false since 2026-07-30,
 * so the tier's "+2 daily credits" resolved to 2 x nothing.
 *
 * The make-good is the HOLDER-SPECIFIC part only — 2 credits a day for the
 * days the cron was dead. The base 10 daily credits were switched off
 * deliberately as policy for everyone, and restoring those here would be
 * quietly reversing a pricing decision rather than honouring a tier.
 *
 * Not covered here: the ~$1.57 of purchase discount they were also owed. That
 * one needs a decision on whether the discount gets built or the wording gets
 * changed, so it is deliberately left alone.
 *
 * SETTLED 2026-09-06: paid by hand from the admin panel as an admin_grant, not
 * through this script, so the ref_key guard below never saw it. The duplicate
 * check therefore also looks for any matching grant in the ledger — a script
 * that pays a second time because someone did the job manually is worse than no
 * script at all.
 *
 *   node --env-file=.env --import tsx scripts/holder-makegood.mts          # dry run
 *   node --env-file=.env --import tsx scripts/holder-makegood.mts --apply
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { logCreditGrant } from "/home/neon/cyberpunk-grok-api/api/_lib/credit-ledger.ts";

const APPLY = process.argv.includes("--apply");

/**
 * The window the holder bonus went unpaid. Both ends are fixed.
 *
 * The end date matters as much as the start: this used to measure to Date.now(),
 * so the "debt" grew by 2 every day the script sat unrun — it read 76 on the day
 * it was written and 80 two days later. A make-good for a closed period is a
 * fixed number, and anything that drifts cannot be reconciled against what was
 * actually paid.
 */
const CRON_DIED = new Date("2026-07-30T00:00:00Z");
/** First run after the 09-06 fix, when the bonus started paying again. */
const CRON_RESUMED = new Date("2026-09-07T00:00:00Z");
const PER_DAY = 2; // Operative tier daily bonus
const REF = "holder-perk-backfill-2026-09-06";

const sql = getDb();

const [u] = (await sql`
  SELECT u.id, p.username, u.holder_tier, u.holder_tier_since,
         u.pack_credits, u.daily_credits, u.daily_credits_reset_at
  FROM users u JOIN profiles p ON p.user_id = u.id
  WHERE p.username = 'kaoskaido'`) as any[];

if (!u) { console.error("user not found"); process.exit(1); }

const days = Math.floor((CRON_RESUMED.getTime() - CRON_DIED.getTime()) / 86_400_000);
const owed = days * PER_DAY;

console.log(`user            @${u.username}  (${u.id})`);
console.log(`tier            ${u.holder_tier} since ${new Date(u.holder_tier_since).toISOString().slice(0, 10)}`);
console.log(`daily cron died ${CRON_DIED.toISOString().slice(0, 10)}  (reset_at says ${new Date(u.daily_credits_reset_at).toISOString().slice(0, 10)})`);
console.log(`days missed     ${days} x ${PER_DAY}/day = ${owed} credits`);
console.log(`pack_credits    ${u.pack_credits} -> ${Number(u.pack_credits) + owed}`);

// Re-running this must not pay twice, and "twice" includes the hand grant that
// actually settled this on 2026-09-06 without the script's ref_key. Matched on
// source and date rather than amount: the hand grant was 76 and this now
// computes 78, so an amount comparison would have missed it and paid again.
const [dupe] = (await sql`
  SELECT id, amount, source, created_at FROM credit_ledger
  WHERE user_id = ${u.id}::uuid
    AND (ref_key = ${REF}
         OR (source IN ('holder_makegood', 'admin_grant') AND created_at >= ${CRON_DIED}))
  ORDER BY created_at LIMIT 1`) as any[];
if (dupe) {
  console.log(`\nALREADY SETTLED: ${dupe.amount} credits via ${dupe.source} on ${new Date(dupe.created_at).toISOString()}. Nothing to do.`);
  process.exit(0);
}

if (!APPLY) { console.log("\n(dry run — pass --apply to grant)"); process.exit(0); }

const [after] = (await sql`
  UPDATE users SET pack_credits = pack_credits + ${owed}, updated_at = now()
  WHERE id = ${u.id}::uuid
  RETURNING pack_credits`) as any[];

await logCreditGrant(sql, u.id, owed, "holder_makegood", REF);

console.log(`\nGRANTED ${owed} credits. pack_credits is now ${after.pack_credits}.`);

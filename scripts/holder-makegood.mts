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
 *   node --env-file=.env --import tsx scripts/holder-makegood.mts          # dry run
 *   node --env-file=.env --import tsx scripts/holder-makegood.mts --apply
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { logCreditGrant } from "/home/neon/cyberpunk-grok-api/api/_lib/credit-ledger.ts";

const APPLY = process.argv.includes("--apply");

/** Last day the daily cron actually completed, from daily_credits_reset_at. */
const CRON_DIED = new Date("2026-07-30T00:00:00Z");
const PER_DAY = 2; // Operative tier daily bonus
const REF = "holder-perk-backfill-2026-09-06";

const sql = getDb();

const [u] = (await sql`
  SELECT u.id, p.username, u.holder_tier, u.holder_tier_since,
         u.pack_credits, u.daily_credits, u.daily_credits_reset_at
  FROM users u JOIN profiles p ON p.user_id = u.id
  WHERE p.username = 'kaoskaido'`) as any[];

if (!u) { console.error("user not found"); process.exit(1); }

const days = Math.floor((Date.now() - CRON_DIED.getTime()) / 86_400_000);
const owed = days * PER_DAY;

console.log(`user            @${u.username}  (${u.id})`);
console.log(`tier            ${u.holder_tier} since ${new Date(u.holder_tier_since).toISOString().slice(0, 10)}`);
console.log(`daily cron died ${CRON_DIED.toISOString().slice(0, 10)}  (reset_at says ${new Date(u.daily_credits_reset_at).toISOString().slice(0, 10)})`);
console.log(`days missed     ${days} x ${PER_DAY}/day = ${owed} credits`);
console.log(`pack_credits    ${u.pack_credits} -> ${Number(u.pack_credits) + owed}`);

// Re-running this must not pay twice.
const [dupe] = (await sql`
  SELECT id, amount, created_at FROM credit_ledger
  WHERE user_id = ${u.id}::uuid AND ref_key = ${REF} LIMIT 1`) as any[];
if (dupe) {
  console.log(`\nALREADY GRANTED: ${dupe.amount} credits on ${new Date(dupe.created_at).toISOString()}. Nothing to do.`);
  process.exit(0);
}

if (!APPLY) { console.log("\n(dry run — pass --apply to grant)"); process.exit(0); }

const [after] = (await sql`
  UPDATE users SET pack_credits = pack_credits + ${owed}, updated_at = now()
  WHERE id = ${u.id}::uuid
  RETURNING pack_credits`) as any[];

await logCreditGrant(sql, u.id, owed, "holder_makegood", REF);

console.log(`\nGRANTED ${owed} credits. pack_credits is now ${after.pack_credits}.`);

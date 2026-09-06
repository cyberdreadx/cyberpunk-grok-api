/**
 * What the holder perks actually pay out, after the 2026-09-06 fixes.
 *
 * Three things were broken at once and each was fixed in a different file, so
 * this checks all three against the live database rather than against the
 * intent:
 *
 *   1. cron-reset-daily returned before computing the holder bonus whenever
 *      free_credits.daily was off — the SELECT below mirrors the UPDATE
 *      expression exactly, so it shows what tomorrow's run will grant.
 *   2. webhook.ts granted a bonus for the subscription discount but not the
 *      holder discount, so purchases ignored the tier entirely.
 *   3. applyDiscount rounded, which erased the discount on 3-4 credit renders.
 *
 *   node --env-file=.env --import tsx scripts/holder-perks-check.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { applyDiscount } from "/home/neon/cyberpunk-grok-api/api/_lib/discount.ts";
import { isSourceDisabled } from "/home/neon/cyberpunk-grok-api/api/_lib/freeCredits.ts";
import { getHolderState } from "/home/neon/cyberpunk-grok-api/api/v1/_lib/xrge-holder.ts";

const sql = getDb();
const baseOff = await isSourceDisabled("daily");
const base = baseOff ? 0 : 10;

console.log(`free_credits.daily = ${baseOff ? "OFF" : "on"}  ->  base ${base}\n`);

// Mirrors the UPDATE in cron-reset-daily. Read-only.
const rows = (await sql`
  SELECT p.username, u.id, u.holder_tier, u.subscription_tier, u.daily_credits AS now_has,
    (
      (CASE
         WHEN ${base}::int = 0 THEN 0
         WHEN u.subscription_tier IS NOT NULL OR COALESCE(u.subscription_discount_pct, 0) > 0 THEN ${base}::int
         ELSE 0
       END)
      + FLOOR(
        (CASE COALESCE(u.holder_tier, 'none')
          WHEN 'operative' THEN 2::numeric WHEN 'runner' THEN 5::numeric
          WHEN 'architect' THEN 10::numeric ELSE 0::numeric END) *
        CASE
          WHEN COALESCE(u.holder_tier, 'none') IN ('none', 'initiate') THEN 1::numeric
          WHEN u.holder_tier_since IS NULL THEN 1::numeric
          WHEN EXTRACT(EPOCH FROM (now() - u.holder_tier_since)) / 86400 >= 180 THEN 2::numeric
          WHEN EXTRACT(EPOCH FROM (now() - u.holder_tier_since)) / 86400 >= 90 THEN 1.5::numeric
          WHEN EXTRACT(EPOCH FROM (now() - u.holder_tier_since)) / 86400 >= 30 THEN 1.25::numeric
          ELSE 1::numeric END
      )
    )::int AS will_get
  FROM users u JOIN profiles p ON p.user_id = u.id
  WHERE COALESCE(u.holder_tier, 'none') <> 'none'
  ORDER BY u.last_snapshot_total DESC NULLS LAST`) as any[];

console.log("── daily credits ──────────────────────────────────────");
console.log("user                 tier        sub       today  next run");
for (const r of rows) {
  console.log(
    `@${String(r.username).padEnd(19)} ${String(r.holder_tier).padEnd(11)} ` +
    `${String(r.subscription_tier ?? "—").padEnd(9)} ${String(r.now_has).padStart(5)} ${String(r.will_get).padStart(9)}`,
  );
}

console.log("\n── purchase bonus (75-credit starter pack) ────────────");
console.log("user                 pct     base + bonus = granted   eff. price");
for (const r of rows) {
  const h = await getHolderState(sql, r.id);
  const pct = h?.effectiveDiscount ?? 0;
  const bonus = pct > 0 ? Math.floor((75 * pct) / (100 - pct)) : 0;
  const eff = (6.99 / (75 + bonus)).toFixed(4);
  console.log(
    `@${String(r.username).padEnd(19)} ${String(pct).padStart(5)}%  ${String(75).padStart(4)} + ${String(bonus).padStart(3)} = ${String(75 + bonus).padStart(3)}` +
    `        $${eff}/cr`,
  );
}

console.log("\n── generation discount, floor vs the old round ────────");
console.log("cost   12.5%   25%");
for (const c of [2, 3, 4, 5, 7, 10]) {
  console.log(`${String(c).padStart(4)}   ${String(applyDiscount(c, 12.5)).padStart(5)}   ${String(applyDiscount(c, 25)).padStart(3)}`);
}

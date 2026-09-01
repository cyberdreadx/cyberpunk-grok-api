/**
 * Refunds don't go back where the credits came from.
 *
 * deduct_credits() drains daily -> sub -> pack. The app refunds with
 * add_pack_credits(), which always credits the pack bucket. So a failed
 * generation paid for with expiring daily credits comes back as permanent
 * pack credits. Every failure quietly upgrades the credit.
 *
 * api/v1/_lib/credits.ts already does it correctly (restores each bucket by
 * the amount taken); only the app path is flat.
 *
 * This measures how much has been converted.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

const [fn] = await sql`
  SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'deduct_credits' LIMIT 1`;
console.log("── deduct_credits drains in this order ──");
console.log((fn?.def || "(not found)").split("\n").filter((l: string) =>
  /daily_credits|sub_credits|pack_credits/.test(l)).slice(0, 12).join("\n"));

const [fn2] = await sql`
  SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'add_pack_credits' LIMIT 1`;
console.log("\n── add_pack_credits puts them back here ──");
console.log((fn2?.def || "(not found)").split("\n").filter((l: string) =>
  /credits/.test(l)).slice(0, 6).join("\n"));

for (const days of [30, 90, 365]) {
  const [r] = await sql`
    SELECT count(*) AS jobs, coalesce(sum(credits_used), 0) AS credits,
           count(DISTINCT user_id) AS users
    FROM usage_log
    WHERE mode LIKE '%refunded%' AND created_at > now() - (${days} || ' days')::interval`;
  console.log(`\nlast ${String(days).padStart(3)} days: ${r.jobs} refunded jobs, ${r.credits} credits, ${r.users} users`);
}

// Not every refund converts — only the portion that was paid from daily/sub.
// Users who sit on a large pack balance were already paying from pack.
const [split] = await sql`
  SELECT
    count(*) FILTER (WHERE daily_credits > 0 OR sub_credits > 0) AS holds_expiring,
    count(*) AS total
  FROM users WHERE daily_credits + sub_credits + pack_credits > 0`;
console.log(`\nusers holding expiring credits right now: ${split.holds_expiring} of ${split.total} with any balance`);
console.log("(a refund for any of them lands in pack_credits instead)");

process.exit(0);

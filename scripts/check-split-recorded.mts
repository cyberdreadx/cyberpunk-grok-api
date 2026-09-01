process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

const rows = await sql`
  SELECT mode, credits_used, paid_daily, paid_sub, paid_pack, created_at
  FROM usage_log
  WHERE mode LIKE 'comfy-%' AND created_at > now() - interval '30 minutes'
  ORDER BY created_at DESC LIMIT 8`;

console.log("── most recent generations, with the buckets that paid ──");
for (const r of rows) {
  const split = r.paid_daily == null ? "(not recorded)" : `${r.paid_daily}/${r.paid_sub}/${r.paid_pack}`;
  const sums = r.paid_daily != null &&
    Number(r.paid_daily) + Number(r.paid_sub) + Number(r.paid_pack) === Number(r.credits_used);
  console.log(`  ${String(r.mode).padEnd(34)} ${String(r.credits_used).padStart(3)} cr  paid ${split.padEnd(14)} ${r.paid_daily == null ? "" : sums ? "✓ sums" : "✗ MISMATCH"}`);
}

const [agg] = await sql`
  SELECT count(*) FILTER (WHERE paid_daily IS NOT NULL) AS recorded,
         count(*) AS total
  FROM usage_log
  WHERE mode LIKE 'comfy-%' AND created_at > now() - interval '30 minutes'`;
console.log(`\n${agg.recorded} of ${agg.total} recent rows carry a split (older rows predate migration 060)`);
process.exit(0);

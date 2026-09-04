/**
 * When did LongLook last succeed, and what does it fail as?
 *
 *   node --env-file=.env --import tsx scripts/longlook-history.mts
 */
process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

const rows = await sql`
  SELECT mode, count(*)::int AS n,
         min(created_at)::date AS first, max(created_at)::date AS last
  FROM usage_log
  WHERE mode LIKE '%longlook%'
  GROUP BY mode ORDER BY max(created_at) DESC` as any[];

if (!rows.length) console.log("no longlook rows at all");
console.log(`${"mode".padEnd(42)}${"n".padStart(6)}  first        last`);
for (const r of rows) {
  console.log(`${String(r.mode).padEnd(42)}${String(r.n).padStart(6)}  ${String(r.first).slice(0, 15)}  ${String(r.last).slice(0, 15)}`);
}

const recent = await sql`
  SELECT mode, created_at, execution_time_ms
  FROM usage_log WHERE mode LIKE '%longlook%'
  ORDER BY created_at DESC LIMIT 8` as any[];
console.log(`\nmost recent attempts:`);
for (const r of recent) {
  console.log(`  ${String(r.created_at).slice(0, 24)}  ${String(r.mode).padEnd(38)} exec=${r.execution_time_ms ?? "-"}`);
}
process.exit(0);

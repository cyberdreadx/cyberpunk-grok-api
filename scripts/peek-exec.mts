process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();
const rows = await sql`
  SELECT job_id, mode, execution_time_ms, api_cost_cents, created_at
  FROM usage_log
  WHERE mode LIKE '%ltx%' AND created_at > now() - interval '2 hours'
  ORDER BY created_at DESC LIMIT 8` as any[];
console.log(`${"job".padEnd(40)}${"mode".padEnd(20)}${"exec ms".padStart(10)}`);
for (const r of rows) {
  console.log(`${String(r.job_id ?? "-").padEnd(40)}${String(r.mode).padEnd(20)}${String(r.execution_time_ms ?? "-").padStart(10)}`);
}
process.exit(0);

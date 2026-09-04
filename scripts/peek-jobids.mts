process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();

const rows = await sql`
  SELECT job_id, mode, created_at::date AS d
  FROM usage_log
  WHERE job_id IS NOT NULL AND job_id <> ''
  ORDER BY created_at DESC LIMIT 8` as any[];
console.log("recent usage_log.job_id values:");
for (const r of rows) console.log(`  ${r.d}  ${r.mode.padEnd(24)} ${r.job_id}`);

const [c] = await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE job_id IS NOT NULL AND job_id <> '')::int AS with_job
  FROM usage_log WHERE mode LIKE 'comfy%'` as any[];
console.log(`\ncomfy rows: ${c.total} total, ${c.with_job} carry a job_id`);
process.exit(0);

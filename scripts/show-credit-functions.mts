process.env.RESEND_API_KEY = "";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
const sql = getDb();
for (const name of ["deduct_credits", "add_pack_credits"]) {
  const [r] = await sql`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = ${name} LIMIT 1`;
  console.log(`\n═══ ${name} ═══\n${r?.def || "(not found)"}`);
}
process.exit(0);

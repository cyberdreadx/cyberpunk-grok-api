/**
 * Apply migrations/060_refund_to_source_bucket.sql.
 *
 * The Neon HTTP driver autocommits per statement and has no transactions, so
 * the file is split and run statement by statement. Every statement is
 * idempotent (IF NOT EXISTS / CREATE OR REPLACE), so a partial run is safe to
 * repeat.
 */
process.env.RESEND_API_KEY = "";

import { readFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const text = readFileSync("/home/neon/cyberpunk-grok-api/migrations/060_refund_to_source_bucket.sql", "utf8");

// Split on ";" at the end of a line, but keep $function$ bodies intact.
const statements: string[] = [];
let buf = "";
let inBody = false;
for (const line of text.split("\n")) {
  if (line.includes("$function$")) {
    // A line may open and close in one go; count occurrences.
    const n = (line.match(/\$function\$/g) || []).length;
    if (n % 2 === 1) inBody = !inBody;
  }
  buf += line + "\n";
  if (!inBody && /;\s*$/.test(line)) {
    const s = buf.trim();
    if (s && !s.split("\n").every(l => l.trim().startsWith("--") || !l.trim())) statements.push(s);
    buf = "";
  }
}

console.log(`${statements.length} statements\n`);
for (const s of statements) {
  const label = s.split("\n").find(l => l.trim() && !l.trim().startsWith("--"))?.slice(0, 68);
  try {
    await sql.query(s);
    console.log(`  ok   ${label}`);
  } catch (e: any) {
    console.log(`  FAIL ${label}\n       ${e.message}`);
    process.exit(1);
  }
}

console.log("\n── verifying ──");
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'usage_log' AND column_name IN ('paid_daily','paid_sub','paid_pack')
  ORDER BY column_name`;
console.log(`  usage_log columns: ${cols.map((c: any) => c.column_name).join(", ") || "MISSING"}`);

const fns = await sql`
  SELECT proname FROM pg_proc
  WHERE proname IN ('deduct_credits_split','refund_credits') ORDER BY proname`;
console.log(`  functions: ${fns.map((f: any) => f.proname).join(", ") || "MISSING"}`);

process.exit(0);

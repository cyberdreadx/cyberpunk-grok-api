/**
 * Apply one migration file.
 *
 *   node --env-file=.env --import tsx scripts/apply-migration.mts 061_antifarm_promo.sql
 *
 * The Neon HTTP driver autocommits per statement and has no transactions, so
 * the file is split and run statement by statement. Migrations here are
 * written idempotent (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT), so a
 * partial run is safe to repeat.
 */
process.env.RESEND_API_KEY = "";

import { readFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const file = process.argv[2];
if (!file) { console.error("usage: apply-migration.mts <file.sql>"); process.exit(1); }
const path = file.startsWith("/") ? file : `/home/neon/cyberpunk-grok-api/migrations/${file}`;
const text = readFileSync(path, "utf8");
console.log(`applying ${path}\n`);

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

process.exit(0);

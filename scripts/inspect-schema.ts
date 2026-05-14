/**
 * scripts/inspect-schema.ts
 *
 * Prints columns + indexes for the tables passed as args.
 * Used to reconcile old migrations with the current production schema.
 *
 * USAGE:
 *   bunx tsx --env-file=.env.production scripts/inspect-schema.ts stories payout_requests notifications
 */

import { Client } from "@neondatabase/serverless";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error("DATABASE_URL not set"); process.exit(1); }
  const tables = process.argv.slice(2);
  if (!tables.length) { console.error("Pass one or more table names"); process.exit(1); }

  const client = new Client(dbUrl);
  await client.connect();

  for (const t of tables) {
    console.log(`\n=== ${t} ===`);

    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [t],
    );
    if (cols.rowCount === 0) {
      console.log("  (table does not exist)");
      continue;
    }
    console.log("Columns:");
    for (const r of cols.rows) {
      console.log(`  ${r.column_name.padEnd(28)} ${String(r.data_type).padEnd(28)} ${r.is_nullable === "NO" ? "NOT NULL" : "NULL"}  default=${r.column_default ?? ""}`);
    }

    const idx = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,
      [t],
    );
    console.log("Indexes:");
    for (const r of idx.rows) {
      console.log(`  ${r.indexname}`);
      console.log(`    ${r.indexdef}`);
    }
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

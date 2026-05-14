/**
 * scripts/check-migrations.ts
 *
 * Walks every .sql file in `migrations/` and `supabase/migrations/`, extracts the
 * tables / columns / indexes it creates, and probes the live Neon database to
 * report whether each migration is fully applied, partially applied, or missing.
 *
 * The project has no `schema_migrations` table — every file is written with
 * `IF NOT EXISTS` / `IF EXISTS` guards so reruns are safe. That makes the
 * presence of its declared artifacts the only reliable signal.
 *
 * USAGE
 *   # 1. Pull production env into .env.production
 *   vercel env pull .env.production --environment=production --yes
 *
 *   # 2. Run the checker
 *   bunx tsx --env-file=.env.production scripts/check-migrations.ts
 *   # or:  npx -y tsx --env-file=.env.production scripts/check-migrations.ts
 *
 *   Optional flags:
 *     --only=035,037     only check specific migration numbers / prefixes
 *     --missing-only     hide migrations that are fully applied
 *     --verbose          print every artifact (default: summary)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MigrationArtifacts {
  file: string;
  number: string; // e.g. "035" or "20260325_xrge_bank_loyalty"
  tables: string[];
  columns: Array<{ table: string; column: string }>;
  indexes: string[];
}

interface ProbeResult {
  artifact: string;
  kind: "table" | "column" | "index";
  present: boolean;
}

interface MigrationStatus {
  migration: MigrationArtifacts;
  results: ProbeResult[];
  state: "applied" | "partial" | "missing" | "empty" | "superseded";
}

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_DIRS = [
  path.join(ROOT, "migrations"),
  path.join(ROOT, "supabase", "migrations"),
];

// Files whose schema has been rebuilt by a later one-off / direct edit.
// Their probed artifacts don't exist anymore (renamed columns/indexes), but
// the live tables are correct and functionally equivalent. Marked here so
// the checker doesn't keep nagging.
const SUPERSEDED = new Set<string>([
  // payout_requests rebuilt for crypto payouts: user_id -> creator_id,
  // added wallet_address/currency/tx_hash, replaced idx_payout_requests_user
  // with idx_payout_requests_creator.
  "015_payouts.sql",
  // notifications rebuilt: read -> is_read, partial idx_notifications_unread
  // dropped in favor of compound idx_notifications_user (user_id, is_read, created_at DESC).
  "023_notifications.sql",
]);

// ── CLI ────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY_FILTERS = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
const MISSING_ONLY = args.has("--missing-only");
const VERBOSE = args.has("--verbose");

// ── Helpers ────────────────────────────────────────────────────────────────

function stripComments(sql: string): string {
  // Strip /* ... */ blocks, then -- ... line comments. Naïve but adequate
  // because every project migration uses straightforward SQL (no string
  // literals containing -- or /*).
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

function stripQuotes(name: string): string {
  return name.replace(/^["`]/, "").replace(/["`]$/, "");
}

function unschema(name: string): string {
  // Drop schema prefix (public.foo → foo) for matching against information_schema
  const parts = stripQuotes(name).split(".");
  return parts[parts.length - 1];
}

function parseArtifacts(file: string, raw: string): MigrationArtifacts {
  const sql = stripComments(raw);
  const tables: string[] = [];
  const columns: Array<{ table: string; column: string }> = [];
  const indexes: string[] = [];

  // CREATE TABLE [IF NOT EXISTS] [public.]name
  const tableRe = /create\s+(?:unlogged\s+|temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`]+)/gi;
  for (const m of sql.matchAll(tableRe)) {
    tables.push(unschema(m[1]).toLowerCase());
  }

  // ALTER TABLE [public.]name ... ADD COLUMN [IF NOT EXISTS] col ...
  // Captures every ADD COLUMN in a comma-separated ALTER TABLE list too.
  const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?([\w."`]+)([\s\S]*?);/gi;
  for (const m of sql.matchAll(alterRe)) {
    const tableName = unschema(m[1]).toLowerCase();
    const body = m[2];
    const colRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?([\w."`]+)/gi;
    for (const c of body.matchAll(colRe)) {
      columns.push({ table: tableName, column: unschema(c[1]).toLowerCase() });
    }
  }

  // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name
  const indexRe = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."`]+)/gi;
  for (const m of sql.matchAll(indexRe)) {
    indexes.push(unschema(m[1]).toLowerCase());
  }

  // Derive a short identifier — "035" for 035_xrge_holder_tiers.sql,
  // or "20260325_xrge_bank_loyalty" for supabase-style stamps.
  const base = path.basename(file, ".sql");
  const num = base.match(/^(\d+)_/)?.[1] || base;

  return {
    file,
    number: num,
    tables: Array.from(new Set(tables)),
    columns: dedupeColumns(columns),
    indexes: Array.from(new Set(indexes)),
  };
}

function dedupeColumns(arr: Array<{ table: string; column: string }>) {
  const seen = new Set<string>();
  const out: typeof arr = [];
  for (const c of arr) {
    const k = `${c.table}.${c.column}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// ── Probes ─────────────────────────────────────────────────────────────────

async function probeTable(sql: any, name: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${name}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function probeColumn(sql: any, table: string, column: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function probeIndex(sql: any, name: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ${name}
    LIMIT 1
  `;
  return rows.length > 0;
}

// ── Runner ─────────────────────────────────────────────────────────────────

async function collectMigrations(): Promise<MigrationArtifacts[]> {
  const all: MigrationArtifacts[] = [];
  for (const dir of MIGRATION_DIRS) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".sql")) continue;
      const full = path.join(dir, name);
      const raw = await fs.readFile(full, "utf8");
      all.push(parseArtifacts(full, raw));
    }
  }
  all.sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file)));
  return all;
}

function matchesFilter(m: MigrationArtifacts): boolean {
  if (!ONLY_FILTERS) return true;
  const base = path.basename(m.file, ".sql").toLowerCase();
  return ONLY_FILTERS.some((f) => {
    const needle = f.toLowerCase().trim();
    return base.startsWith(needle) || m.number === needle || base.includes(needle);
  });
}

async function probeMigration(sql: any, m: MigrationArtifacts): Promise<MigrationStatus> {
  const results: ProbeResult[] = [];

  for (const t of m.tables) {
    results.push({ artifact: t, kind: "table", present: await probeTable(sql, t) });
  }
  for (const c of m.columns) {
    results.push({
      artifact: `${c.table}.${c.column}`,
      kind: "column",
      present: await probeColumn(sql, c.table, c.column),
    });
  }
  for (const i of m.indexes) {
    results.push({ artifact: i, kind: "index", present: await probeIndex(sql, i) });
  }

  const base = path.basename(m.file);
  let state: MigrationStatus["state"];
  if (SUPERSEDED.has(base)) {
    state = "superseded";
  } else if (results.length === 0) {
    state = "empty";
  } else {
    const presentCount = results.filter((r) => r.present).length;
    state = presentCount === 0 ? "missing"
          : presentCount === results.length ? "applied"
          : "partial";
  }

  return { migration: m, results, state };
}

function colorize(s: string, code: string): string {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

function badge(state: MigrationStatus["state"]): string {
  switch (state) {
    case "applied":    return colorize("[ APPLIED    ]", "32");
    case "partial":    return colorize("[ PARTIAL    ]", "33");
    case "missing":    return colorize("[ MISSING    ]", "31");
    case "empty":      return colorize("[ UNKNOWN    ]", "90");
    case "superseded": return colorize("[ SUPERSEDED ]", "36");
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(
      "DATABASE_URL is not set.\n" +
      "Run:  vercel env pull .env.production --environment=production --yes\n" +
      "Then: bunx tsx --env-file=.env.production scripts/check-migrations.ts",
    );
    process.exit(1);
  }

  const sql = neon(dbUrl);
  const all = await collectMigrations();
  const targets = all.filter(matchesFilter);

  console.log("\nProbing", colorize(String(targets.length), "1"), "migrations against the database…\n");

  const statuses: MigrationStatus[] = [];
  for (const m of targets) statuses.push(await probeMigration(sql, m));

  const tally = { applied: 0, partial: 0, missing: 0, empty: 0, superseded: 0 };
  for (const s of statuses) tally[s.state]++;

  for (const s of statuses) {
    if (MISSING_ONLY && s.state !== "missing" && s.state !== "partial") continue;

    const name = path.basename(s.migration.file);
    const total = s.results.length;
    const ok = s.results.filter((r) => r.present).length;
    const summary = s.state === "superseded"
      ? "schema rebuilt by a later migration"
      : total === 0 ? "no probeable artifacts" : `${ok}/${total} artifacts present`;
    console.log(`${badge(s.state)}  ${name.padEnd(48)}  ${summary}`);

    if ((VERBOSE || s.state === "partial") && total > 0 && s.state !== "superseded") {
      for (const r of s.results) {
        const mark = r.present ? colorize("✓", "32") : colorize("✗", "31");
        console.log(`           ${mark} ${r.kind.padEnd(6)} ${r.artifact}`);
      }
    }
  }

  console.log("");
  console.log(
    "Summary: " +
    colorize(`${tally.applied} applied`, "32") + ", " +
    colorize(`${tally.partial} partial`, "33") + ", " +
    colorize(`${tally.missing} missing`, "31") + ", " +
    colorize(`${tally.superseded} superseded`, "36") + ", " +
    colorize(`${tally.empty} unknown`, "90") + ".",
  );

  if (tally.missing > 0 || tally.partial > 0) {
    console.log("\nMissing / partial files to apply (in order):");
    for (const s of statuses) {
      if (s.state === "missing" || s.state === "partial") {
        console.log("  " + path.relative(ROOT, s.migration.file));
      }
    }
    console.log("\nApply with:  bunx tsx --env-file=.env.production scripts/apply-migrations.ts --missing");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

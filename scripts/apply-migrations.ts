/**
 * scripts/apply-migrations.ts
 *
 * Applies SQL migration files to the Neon database using the official
 * @neondatabase/serverless `Client` (multi-statement support, same transport
 * as neonctl). Every project migration is idempotent (`IF NOT EXISTS` guards),
 * so re-running an already-applied file is safe.
 *
 * USAGE
 *   # Pull production env first (one-time):
 *   vercel env pull .env.production --environment=production --yes
 *
 *   # Dry run — show what would be applied, with full file listing:
 *   bunx tsx --env-file=.env.production scripts/apply-migrations.ts --dry
 *
 *   # Apply every migration the checker flagged as missing or partial:
 *   bunx tsx --env-file=.env.production scripts/apply-migrations.ts --missing
 *
 *   # Apply a specific list (order preserved, paths relative to repo root):
 *   bunx tsx --env-file=.env.production scripts/apply-migrations.ts \
 *     migrations/035_xrge_holder_tiers.sql \
 *     migrations/037_creator_applications.sql
 *
 *   # Flags:
 *   --dry              don't execute, just print plan
 *   --missing          auto-discover unapplied migrations (uses same probe as check-migrations.ts)
 *   --include-partial  with --missing, also re-run partially-applied files (default: yes)
 *   --skip-partial     with --missing, skip partial files
 *   --continue         keep going on per-file errors (default: stop on first error)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_DIRS = [
  path.join(ROOT, "migrations"),
  path.join(ROOT, "supabase", "migrations"),
];

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const fileArgs = argv.filter((a) => !a.startsWith("--"));

const DRY = flags.has("--dry");
const AUTO_MISSING = flags.has("--missing");
const INCLUDE_PARTIAL = !flags.has("--skip-partial");
const CONTINUE = flags.has("--continue");

// ── Helpers ────────────────────────────────────────────────────────────────

function colorize(s: string, code: string): string {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

function unschema(name: string): string {
  const parts = name.replace(/^["`]|["`]$/g, "").split(".");
  return parts[parts.length - 1];
}

interface Artifacts {
  tables: string[];
  columns: Array<{ table: string; column: string }>;
  indexes: string[];
}

function parseArtifacts(raw: string): Artifacts {
  const sql = stripComments(raw);
  const tables: string[] = [];
  const columns: Array<{ table: string; column: string }> = [];
  const indexes: string[] = [];

  for (const m of sql.matchAll(/create\s+(?:unlogged\s+|temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`]+)/gi)) {
    tables.push(unschema(m[1]).toLowerCase());
  }
  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([\w."`]+)([\s\S]*?);/gi)) {
    const t = unschema(m[1]).toLowerCase();
    for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([\w."`]+)/gi)) {
      columns.push({ table: t, column: unschema(c[1]).toLowerCase() });
    }
  }
  for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."`]+)/gi)) {
    indexes.push(unschema(m[1]).toLowerCase());
  }

  return {
    tables: Array.from(new Set(tables)),
    columns: dedupeCols(columns),
    indexes: Array.from(new Set(indexes)),
  };
}

function dedupeCols(arr: Array<{ table: string; column: string }>) {
  const seen = new Set<string>();
  const out: typeof arr = [];
  for (const c of arr) {
    const k = `${c.table}.${c.column}`;
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}

async function listAllMigrationFiles(): Promise<string[]> {
  const all: string[] = [];
  for (const dir of MIGRATION_DIRS) {
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { continue; }
    for (const name of entries) {
      if (name.endsWith(".sql")) all.push(path.join(dir, name));
    }
  }
  all.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  return all;
}

async function classify(client: Client, file: string): Promise<"applied" | "partial" | "missing" | "empty"> {
  const raw = await fs.readFile(file, "utf8");
  const a = parseArtifacts(raw);
  const probes: boolean[] = [];

  for (const t of a.tables) {
    const r = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1",
      [t],
    );
    probes.push(r.rowCount! > 0);
  }
  for (const c of a.columns) {
    const r = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1",
      [c.table, c.column],
    );
    probes.push(r.rowCount! > 0);
  }
  for (const i of a.indexes) {
    const r = await client.query(
      "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1 LIMIT 1",
      [i],
    );
    probes.push(r.rowCount! > 0);
  }

  if (probes.length === 0) return "empty";
  const ok = probes.filter(Boolean).length;
  if (ok === probes.length) return "applied";
  if (ok === 0) return "missing";
  return "partial";
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set. Run: vercel env pull .env.production --environment=production --yes");
    process.exit(1);
  }

  const client = new Client(dbUrl);
  await client.connect();

  try {
    let plan: string[] = [];

    if (AUTO_MISSING) {
      const all = await listAllMigrationFiles();
      console.log(`Probing ${all.length} migrations to find unapplied / partial files…\n`);
      for (const f of all) {
        const state = await classify(client, f);
        const rel = path.relative(ROOT, f);
        if (state === "missing") {
          plan.push(f);
          console.log(`  ${colorize("MISSING", "31")}  ${rel}`);
        } else if (state === "partial" && INCLUDE_PARTIAL) {
          plan.push(f);
          console.log(`  ${colorize("PARTIAL", "33")}  ${rel}  (re-running to backfill indexes)`);
        }
      }
      console.log("");
    } else if (fileArgs.length > 0) {
      for (const arg of fileArgs) {
        const abs = path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
        try {
          await fs.access(abs);
          plan.push(abs);
        } catch {
          console.error(colorize(`Not found: ${arg}`, "31"));
          process.exit(1);
        }
      }
    } else {
      console.error("Nothing to do. Pass --missing or one or more migration file paths.");
      process.exit(1);
    }

    if (plan.length === 0) {
      console.log(colorize("Everything is already applied. Nothing to do.", "32"));
      return;
    }

    console.log(`Plan: ${colorize(String(plan.length), "1")} file(s) to apply against ${dbUrlHostHint(dbUrl)}\n`);
    for (const f of plan) console.log("  - " + path.relative(ROOT, f));
    console.log("");

    if (DRY) {
      console.log(colorize("Dry run — no changes made. Re-run without --dry to apply.", "33"));
      return;
    }

    let applied = 0;
    let skipped = 0;
    const failures: Array<{ file: string; error: string }> = [];

    for (const file of plan) {
      const rel = path.relative(ROOT, file);
      const raw = await fs.readFile(file, "utf8");
      process.stdout.write(`Applying ${rel}…`);
      const start = Date.now();
      try {
        await client.query(raw);
        const ms = Date.now() - start;
        console.log(`  ${colorize("OK", "32")} (${ms}ms)`);
        applied++;
      } catch (err: any) {
        const ms = Date.now() - start;
        console.log(`  ${colorize("FAIL", "31")} (${ms}ms)`);
        console.log(`    ${colorize(String(err?.message || err), "31")}`);
        failures.push({ file: rel, error: String(err?.message || err) });
        if (!CONTINUE) {
          skipped = plan.length - applied - 1;
          break;
        }
      }
    }

    console.log("");
    console.log(
      `Summary: ${colorize(`${applied} applied`, "32")}` +
      (failures.length ? `, ${colorize(`${failures.length} failed`, "31")}` : "") +
      (skipped > 0 ? `, ${colorize(`${skipped} skipped`, "90")}` : "") +
      ".",
    );

    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f.file}\n      ${f.error}`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

function dbUrlHostHint(url: string): string {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "");
    return `${u.hostname} / ${db}`;
  } catch {
    return "<unknown host>";
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

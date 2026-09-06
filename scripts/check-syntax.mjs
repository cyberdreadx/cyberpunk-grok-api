#!/usr/bin/env node
/**
 * Parse every handler before it can be committed.
 *
 * tsx transforms each API file the first time a request reaches it, so a syntax
 * error doesn't fail the deploy — it fails every request to that one route,
 * quietly, until someone complains. That cost 17 hours of generation on
 * 2026-09-05 (see 91fe852). This is the gate that would have caught it.
 *
 *   node scripts/check-syntax.mjs [--staged]
 *
 * --staged checks only what git is about to commit, which is what the
 * pre-commit hook uses; with no flag it sweeps api/ and src/ entirely.
 */
import { transformSync } from "esbuild";
import { readFileSync, readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { join, extname } from "path";

const EXT = new Set([".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]);
const staged = process.argv.includes("--staged");

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const fp = join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (EXT.has(extname(e.name))) out.push(fp);
  }
  return out;
}

let files;
if (staged) {
  files = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" })
    .split("\n").filter((f) => f && EXT.has(extname(f)))
    // A staged rename or a file since deleted from the tree isn't ours to judge.
    .filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
} else {
  files = [...walk("api"), ...walk("src"), ...walk("server"), ...walk("scripts")];
}

const broken = [];
for (const f of files) {
  const ext = extname(f);
  try {
    transformSync(readFileSync(f, "utf8"), {
      loader: ext === ".tsx" || ext === ".jsx" ? "tsx" : ext === ".js" || ext === ".mjs" ? "js" : "ts",
      // Match the runtime: tsx transforms per-file with no type information.
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false } },
    });
  } catch (err) {
    const detail = String(err.message).split("\n").slice(1, 3).join("\n  ").trim();
    broken.push(`${f}\n  ${detail}`);
  }
}

if (broken.length) {
  console.error(`\n\x1b[31m✗ ${broken.length} file(s) will not parse:\x1b[0m\n`);
  for (const b of broken) console.error("  " + b + "\n");
  console.error("These would return 500 on every request to their route.\n");
  process.exit(1);
}
console.log(`✓ ${files.length} file(s) parse`);

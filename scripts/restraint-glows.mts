/**
 * Phase 2 of the restraint pass: one glow scale instead of 62.
 *
 * 75 hand-rolled shadow-[0_0…] values across 62 distinct variants — almost every
 * glow in the app was unique. With no shared scale nothing reads as more lit
 * than anything else, which is the same flattening the pulses caused.
 *
 * Mapped by blur radius, because that is what the original author was actually
 * varying:
 *
 *   ≤ 10px  → shadow-glow-focus     an edge, a border, a focused control
 *   ≤ 24px  → shadow-glow-live      active/selected state
 *   > 24px  → shadow-glow-ambient   atmosphere behind a hero or panel
 *
 * Colour is dropped on purpose: the tokens glow in currentColor, so a red badge
 * still glows red without needing a token per hue.
 *
 *   node --import tsx scripts/restraint-glows.mts          # dry run
 *   node --import tsx scripts/restraint-glows.mts --write
 */
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";

const WRITE = process.argv.includes("--write");
const GLOW = /shadow-\[0_0_(\d+)px_[^\]]*\]/g;

const files = execFileSync("grep", ["-rl", "shadow-\\[0_0", "src", "--include=*.tsx"])
  .toString().trim().split("\n").filter(Boolean);

const buckets: Record<string, number> = { focus: 0, live: 0, ambient: 0 };
let total = 0;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  let touched = 0;

  const out = src.replace(GLOW, (_m, px: string) => {
    const r = Number(px);
    const tier = r <= 10 ? "focus" : r <= 24 ? "live" : "ambient";
    buckets[tier]++; total++; touched++;
    return `shadow-glow-${tier}`;
  });

  if (touched) {
    console.log(`${touched.toString().padStart(3)}  ${f.replace("src/", "")}`);
    if (WRITE) writeFileSync(f, out);
  }
}

console.log(`\n${total} glows → 3 tokens`);
console.log(`  focus   ${buckets.focus}   (≤10px — edges, focus rings)`);
console.log(`  live    ${buckets.live}   (≤24px — active state)`);
console.log(`  ambient ${buckets.ambient}   (>24px — atmosphere)`);
if (!WRITE) console.log(`\ndry run — pass --write to apply`);

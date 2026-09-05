/**
 * Phase 1 of the restraint pass: stop 60 things breathing at once.
 *
 * animate-pulse is an attention signal. Spent on 60 elements it stops signalling
 * anything — the eye habituates and the one pulse that means "your render is
 * running" reads the same as a decorative dot beside static text.
 *
 * KEEP is an explicit allow-list rather than a heuristic, because the difference
 * between a live indicator and an ornament is semantic and grep cannot see it.
 * Everything not on the list loses the class.
 *
 *   node --import tsx scripts/restraint-pulses.mts          # dry run
 *   node --import tsx scripts/restraint-pulses.mts --write
 */
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";

const WRITE = process.argv.includes("--write");

/** Pulses that earn their keep: real loading, real cursors, real countdowns. */
const KEEP: Array<{ re: RegExp; why: string }> = [
  { re: /bg-(muted|card|primary|secondary)\/\d+\s+animate-pulse/, why: "skeleton placeholder" },
  { re: /animate-pulse[^"]*bg-primary\/80/, why: "terminal cursor" },
  { re: /w-2 h-4 bg-primary\/80 animate-pulse/, why: "terminal cursor" },
  { re: /animate-pulse">▌/, why: "working indicator" },
  { re: /ring-2 ring-primary\/50[^"]*animate-pulse/, why: "transient onboarding cue" },
  { re: /rounded-lg bg-muted/, why: "skeleton placeholder" },
  // Orange is this codebase's expiring/urgent colour — flash sales and countdowns.
  { re: /(bg|text)-orange-400 animate-pulse/, why: "expiring — flash sale / countdown" },
  { re: /\{active && .*animate-pulse/, why: "live status indicator" },
];

/** Whole files whose pulses are all legitimately live state. */
const KEEP_FILES = [
  "src/components/RunpodStatusDot.tsx",   // worker liveness
  "src/components/FlashSaleBanner.tsx",   // sale is expiring
  "src/pages/RefLanding.tsx",             // mid-redirect
  "src/pages/TerminalMode.tsx",           // cursors + working state
  "src/components/AdminInsightsPanel.tsx",// streaming cursor
];

const files = execFileSync("grep", ["-rl", "animate-pulse", "src", "--include=*.tsx"])
  .toString().trim().split("\n");

let stripped = 0, kept = 0;
const log: string[] = [];

for (const f of files) {
  if (KEEP_FILES.includes(f)) {
    const n = (readFileSync(f, "utf8").match(/animate-pulse/g) || []).length;
    kept += n;
    log.push(`KEEP  ${f} (${n}) — whole file is live state`);
    continue;
  }

  const lines = readFileSync(f, "utf8").split("\n");
  let touched = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("animate-pulse")) continue;

    const keeper = KEEP.find((k) => k.re.test(lines[i]));
    if (keeper) {
      kept++;
      log.push(`KEEP  ${f}:${i + 1} — ${keeper.why}`);
      continue;
    }

    // Strip the class without collapsing the line's own indentation — the
    // whitespace squeeze has to run on the body only, or every touched line
    // loses its nesting.
    const indent = lines[i].match(/^\s*/)![0];
    const body = lines[i].slice(indent.length)
      .replace(/\s+animate-pulse(?=["\s`])/g, "")
      .replace(/animate-pulse\s+/g, "")
      .replace(/animate-pulse/g, "")
      .replace(/  +/g, " ")
      .replace(/ "/g, '"');
    lines[i] = indent + body;
    stripped++; touched++;
  }

  if (touched && WRITE) writeFileSync(f, lines.join("\n"));
  if (touched) log.push(`STRIP ${f} — ${touched} removed`);
}

for (const l of log.sort()) console.log(l);
console.log(`\nstripped ${stripped} · kept ${kept}`);
if (!WRITE) console.log(`dry run — pass --write to apply`);

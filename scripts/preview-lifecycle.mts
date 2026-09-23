/**
 * What each lifecycle email looks like, and exactly who would get one right now.
 * Sends nothing.
 *
 *   node --env-file=.env --import tsx scripts/preview-lifecycle.mts [outDir]
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { buildCartRecoveryHtml, buildEmptyTankHtml, buildWinbackHtml } from "/home/neon/cyberpunk-grok-api/api/_lib/email.ts";
import {
  renderLifecycleEmail, filterEligible, emptyTankCandidates, winbackCandidates,
  readLifecycleConfig, FLOW_SUBJECTS,
} from "/home/neon/cyberpunk-grok-api/api/_lib/lifecycle.ts";

const sql = getDb();
const out = process.argv[2] || "/tmp/claude-1002/-home-neon/5b6b055f-35b3-4494-b505-802f304e4072/scratchpad";
const FAKE = "00000000-0000-0000-0000-000000000000";

const samples: [string, string][] = [
  ["cart_recovery_1", buildCartRecoveryHtml({ resumeUrl: "#", itemLabel: "pro pack", credits: 240, priceUsd: "19.99", second: false })],
  ["cart_recovery_2", buildCartRecoveryHtml({ resumeUrl: "#", itemLabel: "pro pack", credits: 240, priceUsd: "19.99", second: true })],
  ["empty_tank", buildEmptyTankHtml({ recentJobs: 7 })],
  ["winback_with_credits", buildWinbackHtml({ creditsLeft: 120, wasSubscriber: false })],
  ["winback_ex_subscriber", buildWinbackHtml({ creditsLeft: 0, wasSubscriber: true })],
];
for (const [name, html] of samples) {
  const file = `${out}/lifecycle-${name}.html`;
  writeFileSync(file, renderLifecycleEmail(html, FAKE));
  console.log(`  ${name.padEnd(24)} → ${file}`);
}

console.log("\n── subjects ──");
for (const [flow, subject] of Object.entries(FLOW_SUBJECTS)) console.log(`  ${flow.padEnd(18)} "${subject}"`);

const cfg = await readLifecycleConfig(sql);
console.log(`\n── switch ──\n  enabled=${cfg.enabled} dryRun=${cfg.dryRun} maxPerRun=${cfg.maxPerRun} flows=${JSON.stringify(cfg.flows)}`);

console.log("\n── who would be mailed right now ──");
const tank = await emptyTankCandidates(sql, 500);
const tankOk = await filterEligible(sql, "empty_tank", tank);
console.log(`  empty tank   ${String(tank.length).padStart(4)} at zero and creating  →  ${tankOk.length} pass every rule`);
const wb = await winbackCandidates(sql, 500);
const wbOk = await filterEligible(sql, "winback", wb);
console.log(`  win-back     ${String(wb.length).padStart(4)} quiet past customers  →  ${wbOk.length} pass every rule`);
console.log("  cart recovery: read live from Stripe at send time (72h window)");

const [sup] = (await sql`SELECT COUNT(*)::int n FROM email_suppressions`) as any[];
const [opt] = (await sql`SELECT COUNT(*)::int n FROM notification_prefs WHERE email_enabled = false`) as any[];
console.log(`\n  protected from all of it: ${sup.n} suppressed addresses, ${opt.n} people opted out`);

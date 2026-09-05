/**
 * Does the Minnesota block actually work, and does it hit anyone else?
 *
 * The failure mode that matters here is not "Minnesota gets through" — it is
 * blocking paying customers somewhere else by accident. So this checks known
 * addresses in and around the blocked region, and then counts how many of your
 * real users would have been refused.
 *
 *   node --env-file=.env --import tsx scripts/geo-check.mts
 */
process.env.RESEND_API_KEY = "";

import { lookupRegion, getGeoConfig, checkGeo } from "/home/neon/cyberpunk-grok-api/api/_lib/geo.ts";

const cfg = await getGeoConfig();
console.log(`blocked regions : ${cfg.regions.join(", ")}`);
console.log(`enabled         : ${cfg.enabled}`);
console.log(`scope           : ${cfg.restrictTo.length ? cfg.restrictTo.join(", ") : "everything"}\n`);

// Anchors: the first two should resolve inside Minnesota, the rest must not.
const PROBES: Array<[string, string, string]> = [
  ["Minneapolis (UMN)", "128.101.101.101", "US-MN"],
  ["St. Paul area", "134.84.0.1", "US-MN"],
  ["Chicago", "128.135.0.1", "US-IL"],
  ["Wisconsin (Madison)", "144.92.0.1", "US-WI"],
  ["Google DNS", "8.8.8.8", "US"],
  ["Cloudflare DNS", "1.1.1.1", ""],
  ["London", "212.58.244.20", "GB"],
];

let pass = 0, fail = 0;
console.log(`probe                   ip                 region     verdict`);
for (const [name, ip, expectPrefix] of PROBES) {
  const region = lookupRegion(ip) || "(unknown)";
  const blocked = cfg.enabled && cfg.regions.includes(region);
  const shouldBlock = expectPrefix === "US-MN";
  const ok = blocked === shouldBlock;
  ok ? pass++ : fail++;
  console.log(
    `${name.padEnd(22)} ${ip.padEnd(17)} ${region.padEnd(10)} ${blocked ? "BLOCKED" : "allowed"}` +
    (ok ? "" : `   <-- expected ${shouldBlock ? "BLOCKED" : "allowed"}`),
  );
}

// The real question: how many actual users does this cost?
const { getDb } = await import("/home/neon/cyberpunk-grok-api/api/_lib/db.ts");
const sql = getDb();
try {
  const rows = await sql`
    SELECT DISTINCT ON (user_id) user_id, ip
    FROM trusted_devices WHERE ip IS NOT NULL AND ip <> ''
    ORDER BY user_id, created_at DESC LIMIT 5000` as any[];
  const hit: Record<string, number> = {};
  for (const r of rows) {
    const reg = lookupRegion(String(r.ip));
    if (reg && cfg.regions.includes(reg)) hit[reg] = (hit[reg] || 0) + 1;
  }
  const total = Object.values(hit).reduce((a, b) => a + b, 0);
  console.log(`\nreal users affected: ${total} of ${rows.length} sampled`);
  for (const [k, v] of Object.entries(hit)) console.log(`  ${k}  ${v}`);
} catch (e: any) {
  console.log(`\n(could not sample real user IPs: ${String(e.message).slice(0, 80)})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

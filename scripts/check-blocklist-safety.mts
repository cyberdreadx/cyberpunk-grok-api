/**
 * Guard against blocking a domain or mail host that real customers use.
 *
 * On 2026-09-22 the obvious move was to block mail.wallywatts.com and
 * mail.wabblywabble.com: seven farm domains shared them. This check is what
 * stopped it — 15 paying customers sit on domains behind those same two hosts.
 * Run it before adding anything to LOCAL_DISPOSABLE_ADDITIONS or BLOCKED_MX_HOSTS.
 *
 *   node --env-file=.env --import tsx scripts/check-blocklist-safety.mts
 */
process.env.RESEND_API_KEY = "";

import { promises as dns } from "node:dns";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { isDisposableEmail, localDisposableAdditions } from "/home/neon/cyberpunk-grok-api/api/_lib/disposable-domains.ts";
import { blockedMxHosts, isBlockedMxHost } from "/home/neon/cyberpunk-grok-api/api/_lib/mx-blocklist.ts";

const sql = getDb();
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (!c) fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${d ? `  — ${d}` : ""}`);
};

const payerDomains = ((await sql`
  SELECT DISTINCT split_part(lower(u.email), '@', 2) AS dom
  FROM users u
  WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.amount_cents > 0)
`) as any[]).map((r) => String(r.dom)).filter(Boolean);

console.log(`${payerDomains.length} domains have at least one paying customer\n`);
console.log("── domains we block ourselves must have no paying customer ──");
// Our own additions are the ones we are accountable for. A payer on one of these
// means we blocked a real provider — the mistake this script exists to prevent.
const ours = localDisposableAdditions();
const ourPayers = payerDomains.filter((d) => ours.has(d));
ok("no paying customer on a domain we added", ourPayers.length === 0, ourPayers.join(", "));

console.log("\n── upstream-list domains that have a payer (review, not a failure) ──");
// The upstream list blocks farm domains where a single account happened to buy
// once. That is usually correct — 78 accounts and one $50 buyer is a farm with a
// customer, not a mail provider. It is only wrong when the domain still shows
// real, recent business, so that is what fails here.
const upstreamPayers = payerDomains.filter((d) => !ours.has(d) && isDisposableEmail(`probe@${d}`));
let live = 0;
for (const d of upstreamPayers) {
  const [r] = (await sql`
    SELECT COALESCE(SUM(t.amount_cents), 0)::int cents, MAX(t.created_at) last,
      (SELECT COUNT(*)::int FROM users u2 WHERE split_part(lower(u2.email), '@', 2) = ${d}
         AND EXISTS (SELECT 1 FROM usage_log l WHERE l.user_id = u2.id AND l.created_at > now() - interval '90 days')) active90
    FROM transactions t JOIN users u ON u.id = t.user_id
    WHERE split_part(lower(u.email), '@', 2) = ${d} AND t.amount_cents > 0`) as any[];
  const recent = r.last && Date.now() - new Date(r.last).getTime() < 90 * 86_400_000;
  const stillLive = recent && Number(r.active90) > 0;
  if (stillLive) live++;
  console.log(`  ${stillLive ? "LIVE" : "dead"}  ${d.padEnd(22)} $${(r.cents / 100).toFixed(2).padStart(8)}  last ${r.last ? new Date(r.last).toISOString().slice(0, 10) : "never"}  ${r.active90} active in 90d`);
}
ok("no blocked domain is still doing real business", live === 0, `${live} domain(s) both paid recently and are still generating`);

console.log("\n── no paying customer sits behind a blocked mail host ──");
console.log(`  blocked MX hosts: ${blockedMxHosts().join(", ") || "(none)"}`);
const hits: string[] = [];
for (const d of payerDomains) {
  try {
    const mx = await Promise.race([
      dns.resolveMx(d),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500)),
    ]);
    if (Array.isArray(mx) && mx.some((r) => isBlockedMxHost(r.exchange))) {
      hits.push(`${d} → ${mx.map((r) => r.exchange).join(" ")}`);
    }
  } catch { /* unresolvable: the checker fails open, exactly like signup does */ }
}
ok("no paying domain resolves to a blocked mail host", hits.length === 0, hits.join(" · "));

console.log("\n── suppression list only holds addresses that earned it ──");
const [s] = (await sql`SELECT COUNT(*)::int n FROM email_suppressions`) as any[];
const [p] = (await sql`
  SELECT COUNT(*)::int n FROM email_suppressions s
  JOIN users u ON lower(u.email) = s.email
  WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.amount_cents > 0)`) as any[];
console.log(`  ${s.n} addresses suppressed`);
ok("no paying customer is suppressed", p.n === 0, `${p.n} payers on the suppression list`);

console.log(`\n${fail === 0 ? "SAFE" : `UNSAFE — ${fail} check(s) failed`}`);
process.exit(fail ? 1 : 0);

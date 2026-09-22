/**
 * Suppress the addresses that already proved themselves dead, before the new
 * two-strike rule was in place.
 *
 * Two groups: anything that bounced more than once, and anything that bounced at
 * all on a domain now blocked as disposable. A paying customer is never
 * suppressed, whatever their address did.
 *
 *   node --env-file=.env --import tsx scripts/backfill-bounce-suppressions.mts          # dry run
 *   node --env-file=.env --import tsx scripts/backfill-bounce-suppressions.mts --apply
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { isDisposableEmail } from "/home/neon/cyberpunk-grok-api/api/_lib/disposable-domains.ts";

const APPLY = process.argv.includes("--apply");
const sql = getDb();

const bounced = (await sql`
  SELECT lower(recipient) AS email, COUNT(*)::int AS n
  FROM email_events WHERE event = 'bounced' GROUP BY 1`) as any[];

const payers = new Set<string>(
  ((await sql`
    SELECT lower(u.email) AS email FROM users u
    WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.amount_cents > 0)`) as any[])
    .map((r) => String(r.email)),
);
const already = new Set<string>(
  ((await sql`SELECT email FROM email_suppressions`) as any[]).map((r) => String(r.email)),
);

const plan: { email: string; detail: string }[] = [];
let skippedPayer = 0, skippedHave = 0, skippedSingle = 0;

for (const b of bounced) {
  const email = String(b.email);
  if (already.has(email)) { skippedHave++; continue; }
  if (payers.has(email)) { skippedPayer++; continue; }
  if (b.n >= 2) { plan.push({ email, detail: `Bounced ${b.n} times` }); continue; }
  if (isDisposableEmail(email)) { plan.push({ email, detail: "Bounced; domain blocked as disposable" }); continue; }
  skippedSingle++;
}

console.log(`bounced addresses seen        ${bounced.length}`);
console.log(`  already suppressed          ${skippedHave}`);
console.log(`  skipped: paying customer    ${skippedPayer}`);
console.log(`  skipped: single soft bounce ${skippedSingle}`);
console.log(`TO SUPPRESS                   ${plan.length}`);
const byReason = plan.reduce((a: Record<string, number>, p) => { a[p.detail.split(";")[0]] = (a[p.detail.split(";")[0]] ?? 0) + 1; return a; }, {});
console.log(" ", JSON.stringify(byReason));
console.log("  sample:", plan.slice(0, 5).map((p) => p.email).join(", "));

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }

const CHUNK = 500;
let written = 0;
for (let i = 0; i < plan.length; i += CHUNK) {
  const part = plan.slice(i, i + CHUNK);
  const rows = (await sql`
    INSERT INTO email_suppressions (email, reason, detail)
    SELECT v.email, 'bounced', v.detail
    FROM unnest(${part.map((p) => p.email)}::text[], ${part.map((p) => p.detail)}::text[]) AS v(email, detail)
    ON CONFLICT (email) DO NOTHING
    RETURNING email`) as any[];
  written += rows.length;
}
const [now] = (await sql`SELECT COUNT(*)::int n FROM email_suppressions`) as any[];
console.log(`\nwrote ${written}; suppression list now holds ${now.n}`);

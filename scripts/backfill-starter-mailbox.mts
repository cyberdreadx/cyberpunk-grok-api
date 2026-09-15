/**
 * Fill starter_grants.mailbox for grants made before inbox dedupe existed.
 *
 * Only the EARLIEST grant per inbox gets a mailbox. Later grants to the same
 * inbox — the farmed ones — stay NULL. That keeps the unique index from
 * migration 066 valid, and it means the next account on any inbox that has
 * already been paid is refused. Without the backfill, every farmer who already
 * collected a grant would get one more before the dedupe took hold.
 *
 * Canonicalised with the same function the grant path uses rather than a SQL
 * re-implementation, so the two cannot disagree about what counts as one inbox.
 *
 * A grant whose account was deleted cannot be resolved: starter_grants keeps the
 * row but drops user_id. Those stay NULL and remain covered by the device key.
 *
 *   node --env-file=.env --import tsx scripts/backfill-starter-mailbox.mts          # dry run
 *   node --env-file=.env --import tsx scripts/backfill-starter-mailbox.mts --apply
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { canonicalEmail } from "/home/neon/cyberpunk-grok-api/api/_lib/email-canonical.ts";

const APPLY = process.argv.includes("--apply");
const sql = getDb();

const rows = (await sql`
  SELECT s.id, s.granted_at, s.mailbox, u.email
  FROM starter_grants s
  LEFT JOIN users u ON u.id = s.user_id
  ORDER BY s.granted_at ASC, s.id ASC`) as any[];

// Mailboxes already held must be loaded first. A grant made after this shipped
// can hold an inbox that an older, not-yet-backfilled grant also resolves to;
// giving the older row that mailbox would violate the index.
const seen = new Set<string>(rows.filter((r) => r.mailbox).map((r) => String(r.mailbox)));

const plan: Array<{ id: string; mailbox: string }> = [];
const grantsPerInbox = new Map<string, number>();
let alreadySet = 0, unresolved = 0, repeat = 0;

for (const r of rows) {
  const mailbox = r.mailbox ? String(r.mailbox) : canonicalEmail(r.email);
  if (mailbox) grantsPerInbox.set(mailbox, (grantsPerInbox.get(mailbox) ?? 0) + 1);

  if (r.mailbox) { alreadySet++; continue; }
  if (!mailbox) { unresolved++; continue; }
  if (seen.has(mailbox)) { repeat++; continue; }

  seen.add(mailbox);
  plan.push({ id: r.id, mailbox });
}

console.log(`starter grants              ${rows.length}`);
console.log(`  mailbox already set       ${alreadySet}`);
console.log(`  unresolvable (deleted)    ${unresolved}`);
console.log(`  first grant for an inbox  ${plan.length}   <- will be set`);
console.log(`  repeat grant to an inbox  ${repeat}   <- stays NULL (the farmed ones)`);

const worst = [...grantsPerInbox.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
console.log(`\ninboxes paid more than once: ${worst.length}`);
for (const [box, n] of worst.slice(0, 8)) console.log(`  ${box.padEnd(38)} ${n} grants`);

if (!APPLY) {
  console.log("\n(dry run — pass --apply to write)");
  process.exit(0);
}

const ids = plan.map((p) => p.id);
const boxes = plan.map((p) => p.mailbox);
const written = (await sql`
  WITH v AS (SELECT unnest(${ids}::uuid[]) AS id, unnest(${boxes}::text[]) AS mailbox)
  UPDATE starter_grants s SET mailbox = v.mailbox
  FROM v WHERE s.id = v.id AND s.mailbox IS NULL
  RETURNING s.id`) as any[];

const [check] = (await sql`
  SELECT COUNT(*) FILTER (WHERE mailbox IS NOT NULL)::int AS set,
         COUNT(DISTINCT mailbox)::int AS distinct_boxes
  FROM starter_grants`) as any[];

console.log(`\nwrote ${written.length} of ${plan.length}`);
console.log(`now set: ${check.set}, distinct: ${check.distinct_boxes} ${check.set === check.distinct_boxes ? "(one grant per inbox — consistent)" : "(MISMATCH)"}`);

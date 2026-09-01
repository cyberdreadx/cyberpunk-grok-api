/**
 * Find (and optionally delete) spam comments, and claw back the karma they
 * minted.
 *
 *   node --env-file=.env --import tsx scripts/purge-spam-comments.mts
 *   node --env-file=.env --import tsx scripts/purge-spam-comments.mts --apply
 *   …--apply --only=banned,duplicates
 *
 * DRY RUN BY DEFAULT. Nothing is deleted without --apply.
 *
 * Karma matters as much as the rows: comment_post (+1 to the author) and
 * comment_received (+2 to the post owner) are keyed by comment id, and
 * comment_received counts toward the credits earn.ts pays out. Deleting a
 * comment without reverting its karma would leave the farmed balance behind.
 *
 * Categories are deliberately narrow and evidenced. Anything ambiguous is left
 * alone — a false positive here deletes someone's real conversation.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { revertKarma } from "/home/neon/cyberpunk-grok-api/api/_lib/karma.ts";

const sql = getDb();
const APPLY = process.argv.includes("--apply");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const want = (k: string) => !ONLY || ONLY.has(k);

interface Row { id: string; text: string; email: string; created_at: string }

const CATEGORIES: { key: string; label: string; why: string; find: () => Promise<Row[]> }[] = [
  {
    key: "banned",
    label: "Comments by accounts that are banned right now",
    why: "the endpoint never checked bans until today",
    find: async () => await sql`
      SELECT c.id, c.text, u.email, c.created_at
      FROM feed_comments c
      JOIN user_bans b ON b.user_id = c.user_id
      JOIN users u ON u.id = c.user_id
      WHERE b.expires_at IS NULL OR b.expires_at > now()
      ORDER BY c.created_at DESC` as any[],
  },
  {
    key: "tiny",
    label: "One-character comments that are not emoji",
    why: "\".\" and \"k\" are noise; a lone 🔥 is a real reaction and is kept",
    find: async () => await sql`
      SELECT c.id, c.text, u.email, c.created_at
      FROM feed_comments c JOIN users u ON u.id = c.user_id
      WHERE length(btrim(c.text)) <= 1
        -- Keep anything outside the Latin/punctuation range: emoji, CJK and
        -- other single-character scripts are expression, not noise.
        AND btrim(c.text) ~ '^[[:ascii:]]$'
      ORDER BY c.created_at DESC` as any[],
  },
  {
    key: "duplicates",
    label: "Repeat postings of identical text (keeps the first of each)",
    why: "the endpoint now refuses these outright",
    find: async () => await sql`
      SELECT c.id, c.text, u.email, c.created_at FROM (
        SELECT id, text, user_id, created_at,
               row_number() OVER (
                 PARTITION BY user_id, post_id, lower(btrim(text)) ORDER BY created_at
               ) AS rn
        FROM feed_comments
      ) c
      JOIN users u ON u.id = c.user_id
      WHERE c.rn > 1
      ORDER BY c.created_at DESC` as any[],
  },
];

const chosen = CATEGORIES.filter((c) => want(c.key));
if (ONLY) console.log(`categories: ${[...ONLY].join(", ")}\n`);

const seen = new Set<string>();
const toDelete: Row[] = [];

for (const cat of chosen) {
  const rows = await cat.find();
  const fresh = rows.filter((r) => !seen.has(r.id));
  for (const r of fresh) seen.add(r.id);
  toDelete.push(...fresh);

  console.log(`── ${cat.label} ──`);
  console.log(`   ${rows.length} match${rows.length === 1 ? "" : "es"}` +
    (fresh.length !== rows.length ? ` (${fresh.length} new, rest already counted)` : "") +
    ` · ${cat.why}`);
  for (const r of fresh.slice(0, 6)) {
    console.log(`     "${String(r.text).slice(0, 46).replace(/\n/g, " ")}"  — ${String(r.email).slice(0, 28)}`);
  }
  if (fresh.length > 6) console.log(`     …and ${fresh.length - 6} more`);
  console.log();
}

const [total] = await sql`SELECT count(*)::int AS n FROM feed_comments` as any[];
console.log(`${toDelete.length} of ${total.n} comments would be removed (${Math.round((toDelete.length / Math.max(total.n, 1)) * 100)}%)`);

if (toDelete.length) {
  const ids = toDelete.map((r) => r.id);
  const karma = await sql`
    SELECT reason, count(*)::int AS n, sum(delta)::int AS karma
    FROM karma_events
    WHERE source_key = ANY(${ids.map((i) => `comment_post:${i}`)})
       OR source_key = ANY(${ids.map((i) => `comment_received:${i}`)})
    GROUP BY reason` as any[];
  console.log("\nkarma that would be reverted:");
  if (!karma.length) console.log("  none recorded");
  for (const k of karma) console.log(`  ${String(k.reason).padEnd(18)} ${k.n} events, ${k.karma} karma`);
}

if (!APPLY) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --apply to remove these.");
  process.exit(0);
}

console.log("\napplying…");
let deleted = 0;
for (const r of toDelete) {
  // Karma first: if the delete fails the events are still keyed to a real row,
  // whereas orphaned karma after a successful delete is unrecoverable.
  await revertKarma(sql, `comment_post:${r.id}`);
  await revertKarma(sql, `comment_received:${r.id}`);
  const gone = await sql`DELETE FROM feed_comments WHERE id = ${r.id}::uuid RETURNING id` as any[];
  if (gone.length) deleted++;
}
const [after] = await sql`SELECT count(*)::int AS n FROM feed_comments` as any[];
console.log(`deleted ${deleted} comments · ${total.n} → ${after.n}`);
process.exit(0);

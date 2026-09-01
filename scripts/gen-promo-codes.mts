/**
 * Generate single-use invite codes for the anti-farm promo.
 *
 *   node --env-file=.env --import tsx scripts/gen-promo-codes.mts [count]
 *
 * Only the sha256 hash is stored. The plaintext is printed ONCE, here — there
 * is no way to recover it later, which is the point: a database leak should not
 * hand anyone 20 free payouts. Copy them out of this output before closing it.
 *
 * Rejecting a claim releases its code, so a junk submission does not burn one.
 */
process.env.RESEND_API_KEY = "";

import { randomBytes } from "crypto";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { hashCode } from "/home/neon/cyberpunk-grok-api/api/_lib/promo.ts";

const sql = getDb();
const count = Math.min(200, Math.max(1, Number(process.argv[2]) || 20));

// Crockford-ish alphabet: no O/0, I/1, U — these get read aloud and retyped.
const ALPHABET = "ABCDEFGHJKLMNPQRSTVWXYZ23456789";
const block = (n: number) =>
  Array.from(randomBytes(n)).map((b) => ALPHABET[b % ALPHABET.length]).join("");

const existing = await sql`
  SELECT count(*) FILTER (WHERE used_by IS NULL) AS unused, count(*) AS total FROM promo_codes` as any[];
console.log(`existing codes: ${existing[0].total} (${existing[0].unused} unused)\n`);

const made: string[] = [];
for (let i = 0; i < count; i++) {
  const code = `GLTCH-${block(4)}-${block(4)}`;
  try {
    await sql`
      INSERT INTO promo_codes (code_hash, label)
      VALUES (${hashCode(code)}, ${`antireddit-${new Date().toISOString().slice(0, 10)}`})
    `;
    made.push(code);
  } catch {
    i--; // astronomically unlikely collision — just draw again
  }
}

console.log(`── ${made.length} codes, shown once ──`);
for (const c of made) console.log(`  ${c}`);
console.log("\nStore these somewhere now. Only their hashes are in the database.");
process.exit(0);

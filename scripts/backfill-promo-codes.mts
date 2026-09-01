/**
 * Restore the plaintext for promo codes generated before migration 063.
 *
 * The rows only ever held sha256, so the codes cannot be recovered from the
 * database — they are matched by re-hashing the known plaintext and filling in
 * the row that already has that hash. Any code not listed here stays NULL and
 * shows in the admin panel as unrecoverable rather than silently missing.
 *
 *   node --env-file=.env --import tsx scripts/backfill-promo-codes.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { hashCode } from "/home/neon/cyberpunk-grok-api/api/_lib/promo.ts";

const sql = getDb();

// The batch printed at generation on 2026-09-01. None had been claimed.
const KNOWN = [
  "GLTCH-F5JM-FHEM", "GLTCH-BS2K-4DGW", "GLTCH-WXR9-JPBF", "GLTCH-JWV3-SJ8E",
  "GLTCH-XLTY-KGV3", "GLTCH-82FR-PHKP", "GLTCH-HHV8-7MNN", "GLTCH-9T5X-9MFX",
  "GLTCH-YKS5-AAYT", "GLTCH-2DHQ-AKVH", "GLTCH-FH4W-FY9L", "GLTCH-4L6V-4NB8",
  "GLTCH-FF4E-TDZH", "GLTCH-AAGB-QW5B", "GLTCH-BRHK-7CJG", "GLTCH-NVK2-9TMW",
  "GLTCH-J5WR-CQBE", "GLTCH-XSR8-84QK", "GLTCH-JTRX-GJ56", "GLTCH-BG3G-K4RL",
];

let filled = 0;
for (const code of KNOWN) {
  const rows = await sql`
    UPDATE promo_codes SET code = ${code}
    WHERE code_hash = ${hashCode(code)} AND code IS NULL
    RETURNING id` as any[];
  if (rows.length) filled++;
}

const [state] = await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE code IS NOT NULL)::int AS readable,
         count(*) FILTER (WHERE used_by IS NULL)::int AS unused
  FROM promo_codes` as any[];

console.log(`filled ${filled} codes`);
console.log(`promo_codes: ${state.total} total · ${state.readable} readable · ${state.unused} unused`);
if (state.readable < state.total) {
  console.log(`${state.total - state.readable} row(s) have no recoverable plaintext — they still work if someone holds the code, but cannot be shown.`);
}
process.exit(0);

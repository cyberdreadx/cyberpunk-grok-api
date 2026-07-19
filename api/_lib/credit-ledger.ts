/**
 * Append-only audit ledger for credit GRANTS (2026-07 earn-only overhaul).
 *
 * Spends are already logged per-job in usage_log; grants were previously
 * scattered raw UPDATEs across 6+ files with no trail, which made every
 * farming investigation forensic. All new grant paths must log here.
 * (Existing paths — subscription monthly grants, pack purchases, missions —
 *  can be wired in incrementally; the webhook is money-critical, touch last.)
 */
import type { getDb } from "./db";

let ensured = false;

export async function ensureLedgerTable(sql: ReturnType<typeof getDb>): Promise<void> {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INT NOT NULL,
      source TEXT NOT NULL,
      ref_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger (user_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_credit_ledger_source ON credit_ledger (source, created_at)`;
  ensured = true;
}

/** Best-effort grant logging — never let audit failure break the grant itself. */
export async function logCreditGrant(
  sql: ReturnType<typeof getDb>,
  userId: string,
  amount: number,
  source: string,
  refKey?: string,
): Promise<void> {
  try {
    await ensureLedgerTable(sql);
    await sql`
      INSERT INTO credit_ledger (user_id, amount, source, ref_key)
      VALUES (${userId}::uuid, ${amount}, ${source}, ${refKey ?? null})
    `;
  } catch (err: any) {
    console.error("[credit-ledger] log failed:", err.message);
  }
}

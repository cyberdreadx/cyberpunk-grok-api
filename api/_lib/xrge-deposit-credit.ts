/**
 * Credit a confirmed on-chain XRGE transfer to a user's bank balance.
 *
 * Shared by the paste-a-hash flow (api/v1/xrge-deposit.ts) and the gasless
 * deposit flow (api/v1/xrge-gasless.ts), so both apply the same wallet-binding
 * rule and the same once-per-transaction guarantee.
 */

import { getXrgeConfig, verifyXrgeTransfer, weiToXrge } from "./xrge";

export class DepositError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "DepositError";
  }
}

/**
 * The wallet a deposit comes from must be the account's linked wallet. With no
 * wallet linked yet, the sender is linked now (trust on first use) unless it
 * already belongs to another account. Without this, anyone watching Base could
 * claim someone else's confirmed deposit by racing them to the endpoint.
 */
export async function assertDepositWallet(sql: any, userId: string, sender: string): Promise<void> {
  sender = sender.trim().toLowerCase();
  const [owner] = await sql`SELECT wallet_address FROM users WHERE id = ${userId}`;
  const boundWallet = String(owner?.wallet_address || "").trim().toLowerCase();

  if (boundWallet) {
    if (sender !== boundWallet) {
      console.warn(`[xrge-deposit] sender mismatch: tx from ${sender}, user ${userId} bound ${boundWallet}`);
      throw new DepositError(403, "This transfer was not sent from your linked wallet.");
    }
    return;
  }

  const [claimedBy] = await sql`
    SELECT id FROM users WHERE lower(wallet_address) = ${sender} AND id <> ${userId} LIMIT 1
  `.catch(() => [undefined]);
  if (claimedBy) {
    console.warn(`[xrge-deposit] sender ${sender} already bound to another account; refusing for ${userId}`);
    throw new DepositError(403, "This wallet is linked to a different account.");
  }
  // Counts as verified: spending from an address (or signing a permit for it)
  // is stronger proof of control than signing a message with it.
  await sql`
    UPDATE users
       SET wallet_address = ${sender}, wallet_verified_at = now(), updated_at = now()
     WHERE id = ${userId}`;
  console.log(`[xrge-deposit] bound wallet ${sender} to user ${userId} on first deposit`);
}

/**
 * Verify `txHash` on Base and credit it. Throws DepositError for anything the
 * user should see (including "needs N confirmations", which callers retry).
 */
export async function creditXrgeDeposit(
  sql: any,
  userId: string,
  txHash: string,
  extraMetadata: Record<string, unknown> = {},
): Promise<{ deposited: number; newBalance: number; txHash: string }> {
  const xrgeConfig = await getXrgeConfig();
  const normalizedHash = txHash.trim().toLowerCase();

  // Pass "0" as the expected amount: deposits accept any amount.
  const transfer = await verifyXrgeTransfer(normalizedHash, "0", xrgeConfig.depositAddress, xrgeConfig.rpcUrl);
  const depositAmount = weiToXrge(transfer.amountWei);
  const depositNum = parseFloat(depositAmount);
  if (depositNum <= 0) throw new DepositError(400, "Zero-value transfer");

  await assertDepositWallet(sql, userId, String(transfer.from || ""));

  // A single on-chain tx must not be redeemable through both the order flow
  // (xrge_orders, /api/xrge-verify) and the bank flow (xrge_bank_txns).
  const [alreadyOrder] = await sql`
    SELECT id FROM xrge_orders WHERE lower(tx_hash) = ${normalizedHash} AND status = 'verified' LIMIT 1
  `.catch(() => [undefined]);
  if (alreadyOrder) throw new DepositError(400, "This transaction has already been credited");

  // Atomically: insert txn record (unique tx_hash prevents double-credit),
  // then credit balance — all in one CTE so concurrent requests can't both succeed
  const result = await sql`
    WITH new_txn AS (
      INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, tx_hash, metadata)
      SELECT
        ${userId}, 'deposit', ${depositAmount}::numeric, 0,
        ${normalizedHash},
        ${JSON.stringify({ from: transfer.from, block: transfer.blockNumber, confirmations: transfer.confirmations, ...extraMetadata })}::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM xrge_bank_txns WHERE tx_hash = ${normalizedHash} AND type = 'deposit'
      )
      RETURNING id
    ), credit AS (
      UPDATE users
      SET xrge_bank_balance = xrge_bank_balance + ${depositAmount}::numeric,
          updated_at = now()
      WHERE id = ${userId} AND EXISTS (SELECT 1 FROM new_txn)
      RETURNING xrge_bank_balance
    )
    SELECT
      (SELECT xrge_bank_balance FROM credit) AS new_balance,
      EXISTS(SELECT 1 FROM new_txn) AS inserted
  `;

  if (!result[0]?.inserted) throw new DepositError(400, "This transaction has already been credited");

  console.log(`[xrge-deposit] ${depositAmount} XRGE deposited for user ${userId} (tx: ${normalizedHash})`);
  return { deposited: depositNum, newBalance: parseFloat(result[0].new_balance), txHash: normalizedHash };
}

/** Messages from verification that are safe (and useful) to show the user. */
export const SAFE_DEPOSIT_MESSAGES = [
  "Invalid transaction hash", "Transaction not found", "Transaction failed", "confirmation",
  "No XRGE transfer", "not sent to the correct", "Insufficient amount", "Zero-value",
];

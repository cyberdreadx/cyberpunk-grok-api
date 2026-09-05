/**
 * POST /api/v1/xrge-deposit
 * Verify an on-chain XRGE transfer and credit the user's bank balance.
 *
 * Body: { txHash: string, walletAddress?: string }
 * Auth: X-API-Key or Authorization: Bearer JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { getXrgeConfig, verifyXrgeTransfer, weiToXrge } from "../_lib/xrge";

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiKeyAuth = await getUserFromApiKey(req);
    const jwtAuth = !apiKeyAuth ? getUserFromRequest(req) : null;
    const userId = apiKeyAuth?.userId || jwtAuth?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { txHash, walletAddress } = req.body || {};
    if (!txHash) return res.status(400).json({ error: "txHash is required" });

    const sql = getDb();
    const xrgeConfig = await getXrgeConfig();
    const normalizedHash = txHash.trim().toLowerCase();

    // Verify on-chain — pass "0" as expected amount (deposits accept any amount)
    const transfer = await verifyXrgeTransfer(txHash, "0", xrgeConfig.depositAddress, xrgeConfig.rpcUrl);
    const depositAmount = weiToXrge(transfer.amountWei);
    const depositNum = parseFloat(depositAmount);

    if (depositNum <= 0) {
      return res.status(400).json({ error: "Zero-value transfer" });
    }

    // verifyXrgeTransfer only validates the RECIPIENT, so without a sender
    // check anyone watching Base could claim someone else's confirmed deposit
    // by racing them to this endpoint, then withdraw the tokens to their own
    // address. Tie the transfer to the depositing account's wallet:
    //   - wallet already bound  → the sender must match it.
    //   - no wallet bound yet   → bind the sender now (trust on first use),
    //     unless that address already belongs to another account.
    const [owner] = await sql`SELECT wallet_address FROM users WHERE id = ${userId}`;
    const boundWallet = String(owner?.wallet_address || "").trim().toLowerCase();
    const sender = String(transfer.from || "").trim().toLowerCase();

    if (boundWallet) {
      if (sender !== boundWallet) {
        console.warn(`[xrge-deposit] sender mismatch: tx from ${sender}, user ${userId} bound ${boundWallet}`);
        return res.status(403).json({ error: "This transfer was not sent from your linked wallet." });
      }
    } else {
      const [claimedBy] = await sql`
        SELECT id FROM users WHERE lower(wallet_address) = ${sender} AND id <> ${userId} LIMIT 1
      `.catch(() => [undefined]);
      if (claimedBy) {
        console.warn(`[xrge-deposit] sender ${sender} already bound to another account; refusing for ${userId}`);
        return res.status(403).json({ error: "This wallet is linked to a different account." });
      }
      // Counts as verified: spending from an address is stronger proof of control
      // than signing a message with it.
      await sql`
        UPDATE users
           SET wallet_address = ${sender}, wallet_verified_at = now(), updated_at = now()
         WHERE id = ${userId}`;
      console.log(`[xrge-deposit] bound wallet ${sender} to user ${userId} on first deposit`);
    }

    // A single on-chain tx must not be redeemable through both the order flow
    // (xrge_orders, /api/xrge-verify) and the bank flow (xrge_bank_txns).
    const [alreadyOrder] = await sql`
      SELECT id FROM xrge_orders WHERE lower(tx_hash) = ${normalizedHash} AND status = 'verified' LIMIT 1
    `.catch(() => [undefined]);
    if (alreadyOrder) {
      return res.status(400).json({ error: "This transaction has already been credited" });
    }

    // Atomically: insert txn record (unique tx_hash prevents double-credit),
    // then credit balance — all in one CTE so concurrent requests can't both succeed
    const result = await sql`
      WITH new_txn AS (
        INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, tx_hash, metadata)
        SELECT
          ${userId}, 'deposit', ${depositAmount}::numeric, 0,
          ${normalizedHash},
          ${JSON.stringify({ from: transfer.from, block: transfer.blockNumber, confirmations: transfer.confirmations })}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM xrge_bank_txns WHERE tx_hash = ${normalizedHash} AND type = 'deposit'
        )
        RETURNING id
      ), credit AS (
        UPDATE users
        SET xrge_bank_balance = xrge_bank_balance + ${depositAmount}::numeric,
            wallet_address = COALESCE(${walletAddress || null}, wallet_address),
            updated_at = now()
        WHERE id = ${userId} AND EXISTS (SELECT 1 FROM new_txn)
        RETURNING xrge_bank_balance
      )
      SELECT
        (SELECT xrge_bank_balance FROM credit) AS new_balance,
        EXISTS(SELECT 1 FROM new_txn) AS inserted
    `;

    if (!result[0]?.inserted) {
      return res.status(400).json({ error: "This transaction has already been credited" });
    }

    const newBalance = parseFloat(result[0].new_balance);

    console.log(`[xrge-deposit] ${depositAmount} XRGE deposited for user ${userId} (tx: ${txHash})`);

    return res.status(200).json({
      success: true,
      deposited: depositNum,
      newBalance,
      txHash: txHash.trim().toLowerCase(),
    });
  } catch (err: any) {
    console.error("[xrge-deposit]", err.message);
    const safeMessages = ["Invalid transaction hash", "Transaction not found", "Transaction failed", "confirmation", "No XRGE transfer", "not sent to the correct", "Insufficient amount", "Zero-value"];
    const isSafe = safeMessages.some(m => err.message?.includes(m));
    return res.status(400).json({ error: isSafe ? err.message : "Deposit verification failed" });
  }
}

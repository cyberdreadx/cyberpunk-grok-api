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

    // Check for duplicate tx_hash
    const dupes = await sql`
      SELECT id FROM xrge_bank_txns WHERE tx_hash = ${txHash.trim().toLowerCase()} AND type = 'deposit'
    `;
    if (dupes.length > 0) {
      return res.status(400).json({ error: "This transaction has already been credited" });
    }

    // Verify on-chain — pass "0" as expected amount (deposits accept any amount)
    const transfer = await verifyXrgeTransfer(txHash, "0", xrgeConfig.depositAddress, xrgeConfig.rpcUrl);
    const depositAmount = weiToXrge(transfer.amountWei);
    const depositNum = parseFloat(depositAmount);

    if (depositNum <= 0) {
      return res.status(400).json({ error: "Zero-value transfer" });
    }

    // Credit bank balance atomically
    const [updated] = await sql`
      UPDATE users
      SET xrge_bank_balance = xrge_bank_balance + ${depositAmount}::numeric,
          wallet_address = COALESCE(${walletAddress || null}, wallet_address),
          updated_at = now()
      WHERE id = ${userId}
      RETURNING xrge_bank_balance
    `;

    const newBalance = parseFloat(updated.xrge_bank_balance);

    // Record transaction
    await sql`
      INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, tx_hash, metadata)
      VALUES (
        ${userId}, 'deposit', ${depositAmount}::numeric, ${newBalance},
        ${txHash.trim().toLowerCase()},
        ${JSON.stringify({ from: transfer.from, block: transfer.blockNumber, confirmations: transfer.confirmations })}
      )
    `;

    // Optionally save wallet address
    if (walletAddress) {
      await sql`
        UPDATE users SET wallet_address = ${walletAddress.trim().toLowerCase()} WHERE id = ${userId} AND wallet_address IS NULL
      `;
    }

    console.log(`[xrge-deposit] ${depositAmount} XRGE deposited for user ${userId} (tx: ${txHash})`);

    return res.status(200).json({
      success: true,
      deposited: depositNum,
      newBalance,
      txHash: txHash.trim().toLowerCase(),
    });
  } catch (err: any) {
    console.error("[xrge-deposit]", err.message);
    return res.status(400).json({ error: err.message || "Deposit verification failed" });
  }
}

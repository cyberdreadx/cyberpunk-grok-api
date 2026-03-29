/**
 * POST /api/v1/xrge/deposit — Deposit XRGE into the custodial bank.
 *
 * Auth: X-API-Key header.
 * Body: { txHash: string, walletAddress?: string }
 *
 * Verifies the on-chain XRGE transfer to our deposit address, credits the
 * user's bank balance, and optionally saves their wallet address.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";
import { getXrgeConfig, verifyXrgeTransfer } from "../_lib/xrge";
import { getBankUser } from "./_lib/xrge-bank";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiAuth = await getUserFromApiKey(req);
    const jwtAuth = !apiAuth ? getUserFromRequest(req) : null;
    const userId = apiAuth?.userId || jwtAuth?.userId;
    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized. Use X-API-Key header or Bearer token.",
      });
    }

    const rlKey = apiAuth ? `apikey:${apiAuth.apiKeyId}` : `user:${userId}`;
    const rl = await checkRateLimit(rlKey, "v1-xrge-deposit", {
      max: 10,
      windowSeconds: 300,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
    }

    const { txHash, walletAddress } = req.body || {};
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ error: "txHash is required (the on-chain transaction hash)." });
    }

    const sql = getDb();

    // Prevent duplicate deposits
    const dupes = await sql`
      SELECT id FROM xrge_bank_txns
      WHERE tx_hash = ${txHash.trim().toLowerCase()} AND type = 'deposit'
    `;
    if (dupes.length > 0) {
      return res.status(409).json({ error: "This transaction has already been deposited." });
    }

    // Also check xrge_orders to prevent reuse across systems
    const orderDupes = await sql`
      SELECT id FROM xrge_orders
      WHERE tx_hash = ${txHash.trim().toLowerCase()} AND status = 'verified'
    `;
    if (orderDupes.length > 0) {
      return res.status(409).json({
        error: "This transaction was already used for a direct credit purchase.",
      });
    }

    const config = await getXrgeConfig();

    // We verify the transfer sent to our deposit address, with "0" as expected
    // amount since any amount is acceptable for a bank deposit.
    const transfer = await verifyXrgeTransfer(
      txHash,
      "0",
      config.depositAddress,
      config.rpcUrl,
    );

    const depositAmount = transfer.amountHuman;
    const depositNumeric = parseFloat(depositAmount);

    if (depositNumeric <= 0) {
      return res.status(400).json({ error: "Transfer amount is zero." });
    }

    // Credit the bank balance
    await sql`
      UPDATE users SET
        xrge_bank_balance = xrge_bank_balance + ${depositAmount}::numeric,
        wallet_address = COALESCE(${walletAddress?.toLowerCase() || transfer.from}, wallet_address),
        updated_at = now()
      WHERE id = ${userId}
    `;

    const user = await getBankUser(sql, userId);
    const newBalance = user ? parseFloat(user.xrge_bank_balance) : depositNumeric;

    // Record the transaction
    await sql`
      INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, tx_hash, note)
      VALUES (
        ${userId},
        'deposit',
        ${depositAmount}::numeric,
        ${newBalance}::numeric,
        ${txHash.trim().toLowerCase()},
        ${"On-chain deposit from " + transfer.from}
      )
    `;

    console.log(
      `[v1/xrge-deposit] ${userId} deposited ${depositAmount} XRGE (tx: ${txHash})`,
    );

    return res.status(200).json({
      success: true,
      deposited: depositAmount,
      balance: newBalance.toFixed(4),
      from: transfer.from,
      confirmations: transfer.confirmations,
    });
  } catch (err: any) {
    console.error("[v1/xrge-deposit]", err.message);
    const status = err.message.includes("not found") || err.message.includes("pending")
      ? 400
      : 500;
    return res.status(status).json({ error: err.message || "Failed to process deposit" });
  }
}

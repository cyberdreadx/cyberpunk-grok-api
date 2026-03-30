/**
 * POST /api/v1/xrge-withdraw
 * Request a withdrawal from the user's XRGE bank balance.
 *
 * Body: { amount: number, toAddress: string }
 * Auth: X-API-Key or Authorization: Bearer JWT.
 *
 * Withdrawals are queued and processed manually/by cron.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { getBankUser } from "./_lib/xrge-bank";

const MIN_WITHDRAWAL = 100; // minimum 100 XRGE

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

    const { amount, toAddress } = req.body || {};
    if (!amount || !toAddress) {
      return res.status(400).json({ error: "amount and toAddress are required" });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} XRGE` });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
      return res.status(400).json({ error: "Invalid Ethereum address" });
    }

    const sql = getDb();
    const user = await getBankUser(sql, userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.bankBalance < withdrawAmount) {
      return res.status(400).json({
        error: "Insufficient balance",
        available: user.bankBalance,
        requested: withdrawAmount,
      });
    }

    // Check for existing pending withdrawal
    const pending = await sql`
      SELECT id FROM xrge_withdrawals
      WHERE user_id = ${userId} AND status IN ('pending', 'processing')
    `;
    if (pending.length > 0) {
      return res.status(400).json({ error: "You already have a pending withdrawal. Wait for it to complete." });
    }

    // Deduct balance and create withdrawal request atomically
    const [result] = await sql`
      WITH deduct AS (
        UPDATE users
        SET xrge_bank_balance = xrge_bank_balance - ${withdrawAmount}::numeric,
            updated_at = now()
        WHERE id = ${userId} AND xrge_bank_balance >= ${withdrawAmount}::numeric
        RETURNING id, xrge_bank_balance
      ), bank_txn AS (
        INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, metadata)
        SELECT id, 'withdrawal', ${withdrawAmount}::numeric, xrge_bank_balance,
               ${JSON.stringify({ toAddress: toAddress.toLowerCase() })}::jsonb
        FROM deduct
        RETURNING user_id
      ), withdraw AS (
        INSERT INTO xrge_withdrawals (user_id, amount, to_address)
        SELECT id, ${withdrawAmount}::numeric, ${toAddress.toLowerCase()}
        FROM deduct
        RETURNING id
      )
      SELECT
        (SELECT xrge_bank_balance FROM deduct) AS new_balance,
        (SELECT id FROM withdraw) AS withdrawal_id,
        EXISTS(SELECT 1 FROM deduct) AS success
    `;

    if (!result?.success) {
      return res.status(400).json({ error: "Insufficient balance (race condition)" });
    }

    console.log(`[xrge-withdraw] ${userId} requested withdrawal of ${withdrawAmount} XRGE to ${toAddress}`);

    return res.status(200).json({
      success: true,
      withdrawalId: result.withdrawal_id,
      amount: withdrawAmount,
      toAddress: toAddress.toLowerCase(),
      newBankBalance: parseFloat(result.new_balance),
      status: "pending",
      note: "Withdrawals are processed within 24 hours.",
    });
  } catch (err: any) {
    console.error("[xrge-withdraw]", err.message);
    return res.status(500).json({ error: "Withdrawal request failed" });
  }
}

/**
 * POST /api/v1/xrge/withdraw — Request withdrawal of XRGE from bank to wallet.
 *
 * Auth: X-API-Key header.
 * Body: { amount: string, toAddress?: string }
 *
 * Creates a withdrawal request. The XRGE is immediately deducted from the
 * user's bank balance and the request enters a processing queue.
 * For security, withdrawals are processed by the backend within ~10 minutes.
 *
 * If toAddress is omitted, uses the user's saved wallet_address.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getDb } from "../_lib/db";
import { getBankUser } from "./_lib/xrge-bank";

const MIN_WITHDRAWAL = 100; // Minimum 100 XRGE to withdraw (gas economics)

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
    const rl = await checkRateLimit(rlKey, "v1-xrge-withdraw", {
      max: 5,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: "Rate limit exceeded. Max 5 withdrawal requests per hour." });
    }

    const { amount, toAddress } = req.body || {};
    if (!amount || typeof amount !== "string") {
      return res.status(400).json({ error: "amount is required (string, e.g. \"500.0000\")." });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number." });
    }
    if (withdrawAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({
        error: `Minimum withdrawal is ${MIN_WITHDRAWAL} XRGE.`,
      });
    }

    const sql = getDb();
    const user = await getBankUser(sql, userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const destination = (toAddress || user.wallet_address || "").toLowerCase().trim();
    if (!destination || !/^0x[a-f0-9]{40}$/i.test(destination)) {
      return res.status(400).json({
        error: "Valid ERC-20 wallet address required. Provide toAddress or save a wallet_address first.",
      });
    }

    const balance = parseFloat(user.xrge_bank_balance) || 0;
    if (balance < withdrawAmount) {
      return res.status(402).json({
        error: "Insufficient XRGE bank balance.",
        balance: balance.toFixed(4),
        requested: amount,
      });
    }

    // Check for pending withdrawals (max 1 at a time)
    const pending = await sql`
      SELECT id FROM xrge_withdrawals
      WHERE user_id = ${userId} AND status IN ('pending', 'processing')
    `;
    if (pending.length > 0) {
      return res.status(409).json({
        error: "You already have a pending withdrawal. Wait for it to complete before requesting another.",
      });
    }

    // Deduct immediately from bank balance
    await sql`
      UPDATE users SET
        xrge_bank_balance = GREATEST(xrge_bank_balance - ${amount}::numeric, 0),
        updated_at = now()
      WHERE id = ${userId}
    `;

    const updatedUser = await getBankUser(sql, userId);
    const newBalance = updatedUser ? parseFloat(updatedUser.xrge_bank_balance) : 0;

    // Create withdrawal request
    const [withdrawal] = await sql`
      INSERT INTO xrge_withdrawals (user_id, amount, to_address, status)
      VALUES (${userId}, ${amount}::numeric, ${destination}, 'pending')
      RETURNING id, created_at
    `;

    // Record bank transaction
    await sql`
      INSERT INTO xrge_bank_txns (user_id, type, amount, balance_after, note)
      VALUES (
        ${userId},
        'withdraw',
        ${(-withdrawAmount).toString()}::numeric,
        ${newBalance}::numeric,
        ${"Withdrawal to " + destination + " (request " + withdrawal.id + ")"}
      )
    `;

    console.log(
      `[v1/xrge-withdraw] ${userId} requested withdrawal of ${amount} XRGE to ${destination}`,
    );

    return res.status(200).json({
      success: true,
      withdrawalId: withdrawal.id,
      amount,
      toAddress: destination,
      status: "pending",
      balance: newBalance.toFixed(4),
      estimatedProcessing: "Within 10 minutes",
    });
  } catch (err: any) {
    console.error("[v1/xrge-withdraw]", err.message);
    return res.status(500).json({ error: err.message || "Failed to process withdrawal" });
  }
}

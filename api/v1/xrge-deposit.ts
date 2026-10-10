/**
 * POST /api/v1/xrge-deposit
 * Verify an on-chain XRGE transfer and credit the user's bank balance.
 *
 * Body: { txHash: string }
 * Auth: X-API-Key or Authorization: Bearer JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromApiKey } from "../_lib/apikey-auth";
import { getUserFromRequest } from "../_lib/auth";
import { creditXrgeDeposit, DepositError, SAFE_DEPOSIT_MESSAGES } from "../_lib/xrge-deposit-credit";

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

    const { txHash } = req.body || {};
    if (!txHash || typeof txHash !== "string") return res.status(400).json({ error: "txHash is required" });

    const result = await creditXrgeDeposit(getDb(), userId, txHash);
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof DepositError) return res.status(err.status).json({ error: err.message });
    console.error("[xrge-deposit]", err.message);
    const isSafe = SAFE_DEPOSIT_MESSAGES.some(m => err.message?.includes(m));
    return res.status(400).json({ error: isSafe ? err.message : "Deposit verification failed" });
  }
}

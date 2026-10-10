/**
 * GET /api/web3-quote — what the web3 edition needs to show prices in XRGE:
 * the user's bank balance and what one credit costs them in XRGE right now
 * (live price, less their loyalty bonus). See api/_lib/web3-spend.ts.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";
import { quoteXrge } from "./_lib/web3-spend";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  try {
    const sql = getDb();
    const [u] = await sql`SELECT COALESCE(xrge_bank_balance, 0) AS balance FROM users WHERE id = ${auth.userId}`;
    if (!u) return res.status(404).json({ error: "User not found" });
    const q = await quoteXrge(sql, auth.userId, 1);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      balance: parseFloat(u.balance) || 0,
      xrgePerCredit: q.xrgePerCredit,
      usdRate: q.usdRate,
      bonusPercent: q.bonusPercent,
    });
  } catch (err: any) {
    console.error("[web3-quote]", err?.message);
    return res.status(503).json({ error: "XRGE price is unavailable right now. Try again in a minute." });
  }
}

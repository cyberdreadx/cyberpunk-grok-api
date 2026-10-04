/**
 * Retire expired credit lots. See migrations/073_credit_lots.sql.
 *
 * Only credits granted with a lot can ever expire — promo giveaways, and packs
 * bought after expiry shipped. Every credit held before then has no lot and is
 * untouchable here. The work happens in expire_credit_lots(), which clamps to
 * the balance (never driving an account negative), records each retirement in
 * the credit ledger, and marks the lot so a second run charges nothing.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (given !== secret) return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const sql = getDb();
    const [r] = (await sql`SELECT * FROM expire_credit_lots(5000)`) as any[];
    const out = { lots: Number(r?.lots ?? 0), credits: Number(r?.credits ?? 0), users: Number(r?.users ?? 0) };
    if (out.lots > 0) {
      console.log(`[cron-credit-expiry] retired ${out.lots} lots: ${out.credits} credits across ${out.users} users`);
    }
    return res.status(200).json(out);
  } catch (err: any) {
    console.error("[cron-credit-expiry] error:", err?.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

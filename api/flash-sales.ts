/**
 * GET /api/flash-sales — Return currently active flash sales (public).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const sql = getDb();
    const sales = await sql`
      SELECT id, title, discount_percent, bonus_credits_percent, packages, starts_at, ends_at, max_uses, uses
      FROM xrge_flash_sales
      WHERE active = true AND starts_at <= now() AND ends_at > now()
        AND (max_uses IS NULL OR uses < max_uses)
      ORDER BY ends_at ASC
    `;
    return res.json({ sales });
  } catch (err: any) {
    console.error("[flash-sales]", err.message);
    return res.status(500).json({ error: "Failed to fetch flash sales" });
  }
}

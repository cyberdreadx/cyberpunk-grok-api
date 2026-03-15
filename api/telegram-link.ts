/**
 * POST /api/telegram-link
 * Verifies a Telegram link code and binds the Telegram account to the web user.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserFromRequest } from "./_lib/auth";
import { getDb } from "./_lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { code } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Link code is required" });
    }

    const sql = getDb();

    const rows = await sql`
      SELECT lc.telegram_user_id, tu.telegram_id, tu.username, tu.first_name
      FROM telegram_link_codes lc
      JOIN telegram_users tu ON tu.id = lc.telegram_user_id
      WHERE lc.code = ${code.trim().toUpperCase()}
        AND lc.used = false
        AND lc.expires_at > now()
    `;

    if (rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired link code" });
    }

    const { telegram_user_id, telegram_id, username, first_name } = rows[0];

    await sql`UPDATE telegram_link_codes SET used = true WHERE code = ${code.trim().toUpperCase()}`;
    await sql`
      UPDATE telegram_users
      SET linked_user_id = ${auth.userId}::uuid, updated_at = now()
      WHERE id = ${telegram_user_id}::uuid
    `;

    return res.status(200).json({
      success: true,
      telegramId: telegram_id,
      telegramUsername: username,
      telegramName: first_name,
    });
  } catch (err: any) {
    console.error("[telegram-link]", err.message);
    return res.status(500).json({ error: "Failed to link account" });
  }
}

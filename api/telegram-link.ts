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

    const normalizedCode = code.trim().toUpperCase();

    // Atomic: mark code as used in one statement to prevent race conditions
    const claimed = await sql`
      UPDATE telegram_link_codes SET used = true
      WHERE code = ${normalizedCode} AND used = false AND expires_at > now()
      RETURNING telegram_user_id
    `;

    if (claimed.length === 0) {
      return res.status(400).json({ error: "Invalid or expired link code" });
    }

    const telegram_user_id = claimed[0].telegram_user_id;

    await sql`
      UPDATE telegram_users
      SET linked_user_id = ${auth.userId}::uuid, updated_at = now()
      WHERE id = ${telegram_user_id}::uuid
    `;

    const rows = await sql`
      SELECT telegram_id, username, first_name FROM telegram_users WHERE id = ${telegram_user_id}::uuid
    `;
    const { telegram_id, username, first_name } = rows[0] || {};

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

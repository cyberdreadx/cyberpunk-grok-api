/**
 * Toggle 2FA for the authenticated user.
 * GET → { enabled }
 * POST { enabled: boolean } → updates and (when disabling) revokes trusted devices.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromRequest } from "../_lib/auth";
import { ensureTrustedDevicesTable, revokeTrustedDevices } from "../_lib/trustedDevice";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  await ensureTrustedDevicesTable();
  const sql = getDb();

  if (req.method === "GET") {
    const rows = await sql`SELECT two_factor_enabled, email_verified FROM users WHERE id = ${auth.userId}`;
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({
      enabled: !!rows[0].two_factor_enabled,
      email_verified: !!rows[0].email_verified,
    });
  }

  if (req.method === "POST") {
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled (boolean) required" });

    if (enabled) {
      // Require verified email so we can actually deliver the code
      const rows = await sql`SELECT email_verified FROM users WHERE id = ${auth.userId}`;
      if (!rows[0]?.email_verified) {
        return res.status(400).json({ error: "Verify your email before enabling 2FA." });
      }
    }

    await sql`UPDATE users SET two_factor_enabled = ${enabled}, updated_at = now() WHERE id = ${auth.userId}`;
    if (!enabled) await revokeTrustedDevices(auth.userId);
    return res.status(200).json({ enabled });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

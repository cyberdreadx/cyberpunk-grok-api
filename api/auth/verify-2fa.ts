/**
 * Verify the 2FA code sent during login.
 * On success: issues JWT and (optionally) sets a 30-day trusted device cookie.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";
import { ensureTrustedDevicesTable, issueTrustedDevice } from "../_lib/trustedDevice";

const MAX_ATTEMPTS = 6;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, code, rememberDevice } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });
    if (!/^\d{6}$/.test(String(code).trim())) return res.status(400).json({ error: "Code must be 6 digits" });

    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "verify-2fa", { max: 10, windowSeconds: 900 });
    if (!allowed) return res.status(429).json({ error: "Too many attempts. Try later." });

    await ensureTrustedDevicesTable();
    const sql = getDb();
    const rows = await sql`
      SELECT id, email, email_verified, two_factor_enabled, two_factor_code,
             two_factor_code_expires_at, two_factor_attempts
      FROM users WHERE email = ${String(email).toLowerCase().trim()}
    `;
    if (rows.length === 0) return res.status(401).json({ error: "Invalid code" });
    const user = rows[0];

    if (!user.two_factor_enabled || !user.two_factor_code) {
      return res.status(400).json({ error: "2FA not pending for this account" });
    }
    if ((user.two_factor_attempts || 0) >= MAX_ATTEMPTS) {
      await sql`UPDATE users SET two_factor_code = NULL, two_factor_code_expires_at = NULL, two_factor_attempts = 0 WHERE id = ${user.id}`;
      return res.status(429).json({ error: "Too many failed attempts. Sign in again to get a new code." });
    }
    if (!user.two_factor_code_expires_at || new Date(user.two_factor_code_expires_at) < new Date()) {
      return res.status(410).json({ error: "Code expired. Sign in again to get a new one." });
    }
    if (user.two_factor_code !== String(code).trim()) {
      await sql`UPDATE users SET two_factor_attempts = COALESCE(two_factor_attempts,0) + 1 WHERE id = ${user.id}`;
      return res.status(401).json({ error: "Invalid code" });
    }

    // Success — clear code
    await sql`
      UPDATE users
      SET two_factor_code = NULL, two_factor_code_expires_at = NULL, two_factor_attempts = 0, updated_at = now()
      WHERE id = ${user.id}
    `;

    if (rememberDevice) {
      await issueTrustedDevice(res, req, user.id);
    }

    const token = signToken({ userId: user.id, email: user.email });
    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
      email_verified: !!user.email_verified,
    });
  } catch (err: any) {
    console.error("[verify-2fa]", err.message);
    return res.status(500).json({ error: "Verification failed" });
  }
}

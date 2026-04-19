import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { applyCors } from "../_lib/cors";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";
import { ensureTrustedDevicesTable, isDeviceTrusted } from "../_lib/trustedDevice";
import { sendTwoFactorEmail, generateVerificationCode } from "../_lib/email";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "login", { max: 10, windowSeconds: 900 });
    if (!allowed) {
      return res.status(429).json({ error: "Too many login attempts. Please try again later." });
    }

    await ensureTrustedDevicesTable();
    const sql = getDb();
    const rows = await sql`
      SELECT id, email, password_hash, email_verified, two_factor_enabled
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
    `;

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // 2FA gate — if enabled and the device is not trusted, send a code and require verification.
    if (user.two_factor_enabled && !(await isDeviceTrusted(req, user.id))) {
      const code = generateVerificationCode();
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
      await sql`
        UPDATE users
        SET two_factor_code = ${code},
            two_factor_code_expires_at = ${expires.toISOString()},
            two_factor_attempts = 0,
            updated_at = now()
        WHERE id = ${user.id}
      `;
      try {
        await sendTwoFactorEmail(user.email, code);
      } catch (e: any) {
        console.error("[login][2fa] send failed", e?.message);
        return res.status(502).json({ error: "Could not send 2FA code. Try again." });
      }
      return res.status(200).json({
        twoFactorRequired: true,
        email: user.email,
      });
    }

    const token = signToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
      email_verified: !!user.email_verified,
    });
  } catch (err: any) {
    console.error("[login]", err.message);
    return res.status(500).json({ error: "Login failed" });
  }
}

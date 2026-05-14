import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { generateVerificationCode, sendVerificationEmail } from "../_lib/email";
import { applyCors } from "../_lib/cors";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Rate limit: 3 resends per IP per 5 minutes (roughly 1 per minute)
    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "resend-code", { max: 3, windowSeconds: 300 });
    if (!allowed) {
      return res.status(429).json({ error: "Please wait before requesting another code." });
    }

    const sql = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    // Also rate limit per email: 3 resends per email per 5 minutes
    const { allowed: emailAllowed } = await checkRateLimit(
      normalizedEmail, "resend-code-email", { max: 3, windowSeconds: 300 }
    );
    if (!emailAllowed) {
      return res.status(429).json({ error: "Please wait before requesting another code." });
    }

    const rows = await sql`
      SELECT id, email_verified FROM users WHERE email = ${normalizedEmail}
    `;

    if (rows.length === 0) {
      // Don't reveal whether an account exists
      return res.status(200).json({ message: "If an account exists, a new code has been sent." });
    }

    const user = rows[0];

    if (user.email_verified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    // Generate a fresh code and reset attempts (30 min expiry)
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await sql`
      UPDATE users
      SET verification_code = ${code},
          verification_code_expires_at = ${expiresAt},
          verification_attempts = 0,
          updated_at = now()
      WHERE id = ${user.id}
    `;

    try {
      await sendVerificationEmail(normalizedEmail, code);
    } catch (emailErr: any) {
      console.error("[resend-code] email send failed:", emailErr.message);
      return res.status(500).json({ error: "Failed to send verification email. Please try again shortly." });
    }

    return res.status(200).json({ message: "A new verification code has been sent to your email." });
  } catch (err: any) {
    console.error("[resend-code]", err.message);
    return res.status(500).json({ error: "Failed to resend code" });
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { generateVerificationCode, sendVerificationEmail } from "../_lib/email";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";

/** Basic email format validation. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Rate limit: 5 signups per IP per 15 minutes
    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "signup", { max: 5, windowSeconds: 900 });
    if (!allowed) {
      return res.status(429).json({ error: "Too many signup attempts. Please try again later." });
    }

    const sql = getDb();
    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate a 6-digit verification code (expires in 10 minutes)
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Check if an unverified account with this email already exists
    const existing = await sql`
      SELECT id, email_verified FROM users WHERE email = ${normalizedEmail}
    `;

    if (existing.length > 0) {
      if (existing[0].email_verified) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      // Unverified account exists — update password + resend code, reset attempts
      await sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            verification_code = ${code},
            verification_code_expires_at = ${expiresAt},
            verification_attempts = 0,
            updated_at = now()
        WHERE id = ${existing[0].id}
      `;
    } else {
      // Insert new user with verification code
      try {
        await sql`
          INSERT INTO users (email, password_hash, email_verified, verification_code, verification_code_expires_at, verification_attempts)
          VALUES (${normalizedEmail}, ${passwordHash}, false, ${code}, ${expiresAt}, 0)
        `;
      } catch (err: any) {
        if (err.message?.includes("unique") || err.code === "23505") {
          return res.status(409).json({ error: "An account with this email already exists" });
        }
        throw err;
      }
    }

    // Send the verification email
    await sendVerificationEmail(normalizedEmail, code);

    return res.status(201).json({
      message: "Verification code sent. Check your email.",
      needsVerification: true,
      email: normalizedEmail,
    });
  } catch (err: any) {
    console.error("[signup]", err.message);
    return res.status(500).json({ error: "Failed to create account" });
  }
}

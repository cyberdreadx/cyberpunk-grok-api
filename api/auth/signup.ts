import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { generateVerificationCode, sendVerificationEmail } from "../_lib/email";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";
import { isDisposableEmail } from "../_lib/disposable-domains";
import { verifyCaptcha } from "../_lib/captcha";
/** Basic email format validation. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, password, referral_code, device_fingerprint, captcha_token, captcha_answer } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    if (!verifyCaptcha(captcha_token, captcha_answer)) {
      return res.status(400).json({ error: "CAPTCHA verification failed. Please try the new challenge.", code: "captcha_failed" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (isDisposableEmail(email)) {
      return res.status(400).json({ error: "Disposable email addresses are not allowed. Please use a permanent email." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Rate limit: 5 signups per IP per 24 hours
    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "signup", { max: 5, windowSeconds: 86400 });
    if (!allowed) {
      return res.status(429).json({ error: "Account creation limit reached for this IP. Try again in 24 hours." });
    }

    // Device fingerprint limit: max 3 verified accounts per device fingerprint
    const fp = typeof device_fingerprint === "string" && device_fingerprint.trim()
      ? device_fingerprint.trim().slice(0, 64) // sanitise length
      : null;

    const sql = getDb();

    if (fp) {
      const fpRows = await sql`
        SELECT COUNT(*) AS cnt FROM users
        WHERE device_fingerprint = ${fp}
          AND email_verified = true
      `;
      const fpCount = Number(fpRows[0]?.cnt ?? 0);
      if (fpCount >= 5) {
        return res.status(429).json({
          error: "Account limit reached for this device. Max 5 accounts per device.",
        });
      }
    }
    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate a 6-digit verification code (expires in 30 minutes)
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Check if an unverified account with this email already exists
    const existing = await sql`
      SELECT id, email_verified FROM users WHERE email = ${normalizedEmail}
    `;

    // Look up referrer if a referral code was provided
    let referrerId: string | null = null;
    if (referral_code && typeof referral_code === "string") {
      const refRows = await sql`
        SELECT id, email FROM users WHERE referral_code = ${referral_code.trim().toUpperCase()}
      `;
      if (refRows.length > 0 && refRows[0].email !== normalizedEmail) {
        referrerId = refRows[0].id;
      }
    }

    let userId: string;

    if (existing.length > 0) {
      if (existing[0].email_verified) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      userId = existing[0].id;
      // Unverified account exists — update password + resend code, reset attempts
      await sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            verification_code = ${code},
            verification_code_expires_at = ${expiresAt},
            verification_attempts = 0,
            referred_by = COALESCE(referred_by, ${referrerId}::uuid),
            updated_at = now()
        WHERE id = ${userId}
      `;
      if (referrerId) {
        await sql`
          INSERT INTO referrals (referrer_id, referee_id)
          VALUES (${referrerId}::uuid, ${userId}::uuid)
          ON CONFLICT (referee_id) DO NOTHING
        `;
      }
    } else {
      try {
        const newRows = await sql`
          INSERT INTO users (email, password_hash, email_verified, verification_code, verification_code_expires_at, verification_attempts, referred_by, device_fingerprint)
          VALUES (${normalizedEmail}, ${passwordHash}, false, ${code}, ${expiresAt}, 0, ${referrerId}::uuid, ${fp})
          RETURNING id
        `;
        userId = newRows[0].id;
        if (referrerId) {
          await sql`
            INSERT INTO referrals (referrer_id, referee_id)
            VALUES (${referrerId}::uuid, ${userId}::uuid)
            ON CONFLICT (referee_id) DO NOTHING
          `;
        }
      } catch (err: any) {
        if (err.message?.includes("unique") || err.code === "23505") {
          return res.status(409).json({ error: "An account with this email already exists" });
        }
        throw err;
      }
    }

    // Issue a token so the user can continue even if email delivery fails.
    const token = signToken({ userId, email: normalizedEmail });

    // Send the verification email — await it so we can warn the user if it fails
    try {
      await sendVerificationEmail(normalizedEmail, code);
    } catch (emailErr: any) {
      console.error("[signup] verification email failed:", emailErr.message);
      // Account was created but email failed — return success with a warning
      return res.status(201).json({
        token,
        user: { id: userId, email: normalizedEmail },
        email_verified: false,
        needsVerification: true,
        emailWarning: "Account created but we couldn't send the verification email. Please try 'Resend Code' in a moment.",
      });
    }

    return res.status(201).json({
      token,
      user: { id: userId, email: normalizedEmail },
      email_verified: false,
      needsVerification: true,
    });
  } catch (err: any) {
    console.error("[signup]", err.message, err.stack);
    return res.status(500).json({ error: "Failed to create account" });
  }
}

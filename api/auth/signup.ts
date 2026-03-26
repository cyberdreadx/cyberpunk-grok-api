import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { generateVerificationCode, sendVerificationEmail } from "../_lib/email";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";
import { isDisposableEmail } from "../_lib/disposable-domains";

/** Basic email format validation. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, password, referral_code } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
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

    // Rate limit: 2 signups per IP per 24 hours
    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(ip, "signup", { max: 2, windowSeconds: 86400 });
    if (!allowed) {
      return res.status(429).json({ error: "Account creation limit reached for this IP. Try again in 24 hours." });
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

    if (existing.length > 0) {
      if (existing[0].email_verified) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      // Unverified account exists — update password + resend code, reset attempts
      // Also set referred_by if not already set
      await sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            verification_code = ${code},
            verification_code_expires_at = ${expiresAt},
            verification_attempts = 0,
            referred_by = COALESCE(referred_by, ${referrerId}::uuid),
            updated_at = now()
        WHERE id = ${existing[0].id}
      `;
      // Create referral row if referrer was found and not already linked
      if (referrerId) {
        await sql`
          INSERT INTO referrals (referrer_id, referee_id)
          VALUES (${referrerId}::uuid, ${existing[0].id}::uuid)
          ON CONFLICT (referee_id) DO NOTHING
        `;
      }
    } else {
      // Insert new user with verification code + referral link
      try {
        const newRows = await sql`
          INSERT INTO users (email, password_hash, email_verified, verification_code, verification_code_expires_at, verification_attempts, referred_by)
          VALUES (${normalizedEmail}, ${passwordHash}, false, ${code}, ${expiresAt}, 0, ${referrerId}::uuid)
          RETURNING id
        `;
        // Create referral row linking referrer → referee
        if (referrerId && newRows.length > 0) {
          await sql`
            INSERT INTO referrals (referrer_id, referee_id)
            VALUES (${referrerId}::uuid, ${newRows[0].id}::uuid)
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

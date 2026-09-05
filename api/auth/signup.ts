import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { getDb } from "../_lib/db";
import { signToken } from "../_lib/auth";
import { generateVerificationCode, sendVerificationEmail } from "../_lib/email";
import { checkRateLimit, getClientIp } from "../_lib/ratelimit";
import { isDisposableEmail } from "../_lib/disposable-domains";
import { isDomainVelocityExceeded } from "../_lib/domain-velocity";
import { verifyCaptcha } from "../_lib/captcha";
import { sameMailbox } from "../_lib/email-canonical";
import { findAmbassadorByCode, attributeSignup, type AmbassadorLookup } from "../_lib/ambassador";
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

    // Device fingerprint limit: max 5 accounts per device fingerprint.
    // The fingerprint is REQUIRED — the web client always sends one (fingerprint.ts
    // never throws), so a missing fingerprint means a scripted signup. Counting
    // includes tombstoned (deleted) accounts so delete→recreate cycles don't
    // reset the cap (farming wave of 2026-07: 44 accounts on one fingerprint).
    const fp = typeof device_fingerprint === "string" && device_fingerprint.trim()
      ? device_fingerprint.trim().slice(0, 64) // sanitise length
      : null;
    if (!fp) {
      return res.status(400).json({ error: "Signup failed. Please use the web app to create an account." });
    }

    const sql = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    // Domain velocity cap: catch-all farm domains rotate faster than the
    // blocklist — block any non-mainstream domain with too many recent signups.
    if (await isDomainVelocityExceeded(sql, normalizedEmail.split("@")[1])) {
      return res.status(429).json({
        error: "Signups from this email domain are temporarily limited. Please use a different email provider.",
      });
    }

    const [fpCounts] = await sql`
      SELECT
        (SELECT COUNT(*) FROM users
          WHERE device_fingerprint = ${fp}) AS live,
        (SELECT COUNT(*) FROM deleted_accounts
          WHERE device_fingerprint = ${fp}) AS tombstoned,
        (SELECT COUNT(*) FROM deleted_accounts
          WHERE email = ${normalizedEmail}
            AND deleted_at > now() - interval '30 days') AS email_tombstoned
    `;
    if (Number(fpCounts?.live ?? 0) + Number(fpCounts?.tombstoned ?? 0) >= 5) {
      return res.status(429).json({
        error: "Account limit reached for this device. Max 5 accounts per device.",
      });
    }
    // Deleted accounts can't re-register the same email for 30 days
    // (stops delete→recreate credit-farming cycles).
    if (Number(fpCounts?.email_tombstoned ?? 0) > 0) {
      return res.status(429).json({
        error: "This email was recently used on a deleted account. Contact support if you need it restored.",
      });
    }
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate a 6-digit verification code (expires in 30 minutes)
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Check if an unverified account with this email already exists
    const existing = await sql`
      SELECT id, email_verified FROM users WHERE email = ${normalizedEmail}
    `;

    // Look up referrer if a referral code was provided. Ambassador vanity
    // codes are checked first; an ambassador's original hex code still works
    // because it falls through to the same legacy lookup below.
    let referrerId: string | null = null;
    let ambassador: AmbassadorLookup | null = null;
    if (referral_code && typeof referral_code === "string") {
      try {
        ambassador = await findAmbassadorByCode(sql, referral_code);
      } catch (e: any) {
        console.error("[ambassador] code lookup failed:", e?.message);
        ambassador = null;
      }
      if (ambassador?.userId) {
        const [ambUser] = await sql`
          SELECT id, email FROM users WHERE id = ${ambassador.userId}::uuid
        `;
        // sameMailbox, not string equality: alice@gmail and alice+ref@gmail are
        // one person, and comparing raw strings let them refer themselves.
        if (ambUser && !sameMailbox(ambUser.email, normalizedEmail)) referrerId = ambUser.id;
        else ambassador = null;
      }
      if (!referrerId) {
        const refRows = await sql`
          SELECT id, email FROM users WHERE referral_code = ${referral_code.trim().toUpperCase()}
        `;
        if (refRows.length > 0 && !sameMailbox(refRows[0].email, normalizedEmail)) {
          referrerId = refRows[0].id;
        }
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

    // Ambassador attribution lives in its own table rather than riding on
    // `referrals`, because it carries money: a commission window that can be
    // extended, fraud state, and an audit trail. Never fatal to signup.
    if (ambassador && referrerId) {
      try {
        await attributeSignup(sql, {
          ambassadorId: ambassador.ambassadorId,
          ambassadorUserId: ambassador.userId,
          userId,
          fingerprint: fp,
        });
      } catch (e: any) {
        console.error("[ambassador] attribution failed:", e?.message);
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

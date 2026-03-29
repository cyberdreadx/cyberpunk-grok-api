/**
 * Email sending utility using Resend.
 * Verification codes, password resets, and daily credit notifications.
 * All sends are logged to the email_log table for delivery tracking.
 */

import { Resend } from "resend";
import { getDb } from "./db";

export type { Resend };

let resend: Resend | null = null;

export function getResend(): Resend {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not configured");
    resend = new Resend(key);
  }
  return resend;
}

export function getFromAddress(): string {
  return process.env.EMAIL_FROM || "noreply@grokrunner.gltch.app";
}

/** Generate a random 6-digit verification code. */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Log an email send attempt to the database. */
async function logEmail(
  recipient: string,
  emailType: string,
  status: "sent" | "failed",
  resendId?: string | null,
  errorMessage?: string | null,
  metadata?: Record<string, any>,
): Promise<void> {
  try {
    const sql = getDb();
    await sql`
      INSERT INTO email_log (recipient, email_type, resend_id, status, error_message, metadata)
      VALUES (
        ${recipient},
        ${emailType},
        ${resendId ?? null},
        ${status},
        ${errorMessage ?? null},
        ${JSON.stringify(metadata ?? {})}::jsonb
      )
    `;
  } catch (logErr: any) {
    // Don't let logging failures break email sending
    console.error("[email-log] Failed to log email:", logErr.message);
  }
}

/** Send a verification code email. */
export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<void> {
  const fromAddress = getFromAddress();

  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: `Your verification code: ${code}`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">
            GROK RUNNER
          </h1>
          <p style="font-size: 14px; color: #a0a0a0; margin: 0 0 24px;">
            Enter this verification code to activate your account:
          </p>
          <div style="background: #111; border: 1px solid #00f0ff55; padding: 16px; text-align: center; border-radius: 4px; margin: 0 0 24px;">
            <span style="font-size: 32px; letter-spacing: 8px; color: #00f0ff; font-weight: bold;">
              ${code}
            </span>
          </div>
          <p style="font-size: 12px; color: #666; margin: 0;">
            This code expires in 30 minutes. If you didn't create an account, ignore this email.
          </p>
        </div>
      </div>
    `,
  });

  if (error) {
    await logEmail(to, "verification", "failed", null, error.message);
    console.error("[email] Failed to send verification email:", error);
    throw new Error("Failed to send verification email");
  }

  await logEmail(to, "verification", "sent", data?.id);
}

/** Send a password reset code email. */
export async function sendPasswordResetEmail(
  to: string,
  code: string,
): Promise<void> {
  const fromAddress = getFromAddress();

  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: `Password reset code: ${code}`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #ff00e533; padding: 24px; border-radius: 4px;">
          <h1 style="color: #ff00e5; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">
            GROK RUNNER
          </h1>
          <p style="font-size: 14px; color: #a0a0a0; margin: 0 0 8px;">
            You requested a password reset. Enter this code:
          </p>
          <div style="background: #111; border: 1px solid #ff00e555; padding: 16px; text-align: center; border-radius: 4px; margin: 0 0 24px;">
            <span style="font-size: 32px; letter-spacing: 8px; color: #ff00e5; font-weight: bold;">
              ${code}
            </span>
          </div>
          <p style="font-size: 12px; color: #666; margin: 0;">
            This code expires in 10 minutes. If you didn't request this, ignore this email — your password won't change.
          </p>
        </div>
      </div>
    `,
  });

  if (error) {
    await logEmail(to, "password_reset", "failed", null, error.message);
    console.error("[email] Failed to send password reset email:", error);
    throw new Error("Failed to send password reset email");
  }

  await logEmail(to, "password_reset", "sent", data?.id);
}

/** Send a daily credits notification email. */
export async function sendDailyCreditsEmail(
  to: string,
  amount: number,
): Promise<void> {
  const fromAddress = getFromAddress();

  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: `Your daily credits are ready!`,
    html: buildDailyCreditsHtml(amount),
  });

  if (error) {
    await logEmail(to, "daily_credits", "failed", null, error.message, { amount });
    console.error("[email] Failed to send daily credits email:", error);
    // Don't throw for daily credits — it's non-critical
    return;
  }

  await logEmail(to, "daily_credits", "sent", data?.id, null, { amount });
}

/** Build the HTML body for the daily credits refill notification. */
export function buildDailyCreditsHtml(amount: number): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
        <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">
          GROK RUNNER
        </h1>
        <p style="font-size: 14px; color: #a0a0a0; margin: 0 0 12px;">
          Your daily credits have been refilled.
        </p>
        <div style="background: #111; border: 1px solid #00f0ff55; padding: 16px; text-align: center; border-radius: 4px; margin: 0 0 16px;">
          <span style="font-size: 36px; color: #00f0ff; font-weight: bold;">${amount}</span>
          <span style="font-size: 14px; color: #00f0ff99; display: block; margin-top: 4px;">FREE CREDITS READY</span>
        </div>
        <p style="font-size: 13px; color: #a0a0a0; margin: 0 0 16px;">
          Use them today — they reset at midnight UTC and don't roll over.
          Generate images, videos, and chat with AI characters.
        </p>
        <a href="https://grokrunner.gltch.app" style="display: inline-block; background: #00f0ff22; border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 10px 24px; border-radius: 4px; font-size: 13px; letter-spacing: 2px;">
          START CREATING →
        </a>
        <p style="font-size: 11px; color: #444; margin: 16px 0 0;">
          You're receiving this because you have a verified Grok Runner account.
        </p>
      </div>
    </div>
  `;
}

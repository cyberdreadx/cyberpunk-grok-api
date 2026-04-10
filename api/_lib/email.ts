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

/** Send the Grok Runner announcement email. */
export async function sendAnnouncementEmail(to: string): Promise<boolean> {
  const fromAddress = getFromAddress();

  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: `🚀 Grok Runner just got a massive upgrade`,
    html: buildAnnouncementHtml(),
  });

  if (error) {
    await logEmail(to, "announcement", "failed", null, error.message);
    console.error("[email] Failed to send announcement to", to, error.message);
    return false;
  }

  await logEmail(to, "announcement", "sent", data?.id);
  return true;
}

/** Build HTML for the big announcement email. */
export function buildAnnouncementHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 520px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 20px; letter-spacing: 3px; margin: 0 0 8px; text-align: center;">
          GROK RUNNER
        </h1>
        <p style="color: #00f0ff99; font-size: 12px; letter-spacing: 4px; text-align: center; margin: 0 0 28px;">
          SYSTEM UPDATE // MAJOR PATCH
        </p>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 20px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 12px; letter-spacing: 1px;">
            🎁 10 FREE DAILY CREDITS
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Every verified account now gets <span style="color: #00f0ff; font-weight: bold;">10 free credits every single day</span>.
            Generate images, create AI videos, edit photos, and chat with AI characters — all on us.
            Credits reset at midnight UTC so use them or lose them!
          </p>
        </div>

        <div style="background: #111; border: 1px solid #ff00e544; padding: 20px; border-radius: 4px; margin: 0 0 20px;">
          <h2 style="color: #ff00e5; font-size: 15px; margin: 0 0 12px; letter-spacing: 1px;">
            📸 NEW: STORIES MODE
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Share your best AI generations with the community! Post your edits, renders, and videos
            as <span style="color: #ff00e5; font-weight: bold;">Stories</span> that appear on the main page for 24 hours.
            See what other Grok Runners are creating, get inspired, and connect with fellow creators.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #39ff1444; padding: 20px; border-radius: 4px; margin: 0 0 20px;">
          <h2 style="color: #39ff14; font-size: 15px; margin: 0 0 12px; letter-spacing: 1px;">
            ⚡ MORE UPDATES
          </h2>
          <ul style="font-size: 13px; color: #b0b0b0; margin: 0; padding-left: 18px; line-height: 1.8;">
            <li>Improved image generation quality</li>
            <li>Faster video rendering pipeline</li>
            <li>New AI character interactions</li>
            <li>Better mobile experience</li>
            <li>Bug fixes & performance boosts</li>
          </ul>
        </div>

        <div style="background: #0d0d15; border: 1px solid #ffaa0044; padding: 20px; border-radius: 4px; margin: 0 0 24px;">
          <h2 style="color: #ffaa00; font-size: 15px; margin: 0 0 12px; letter-spacing: 1px;">
            🔮 COMING SOON
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            We're working on a <span style="color: #ffaa00; font-weight: bold;">Live Feed</span> — think social network
            for AI creators. Post statuses, share your work in real-time, react to other Grok Runners' creations,
            and build your creative community. Stay tuned. 👀
          </p>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            LAUNCH GROK RUNNER →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          You're receiving this because you have a verified Grok Runner account.
        </p>
      </div>
    </div>
  `;
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

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

/** Send a 2FA login code email. */
export async function sendTwoFactorEmail(to: string, code: string): Promise<void> {
  const fromAddress = getFromAddress();
  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: `Your login code: ${code}`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">GROK RUNNER</h1>
          <p style="font-size: 14px; color: #a0a0a0; margin: 0 0 12px;">Two-factor login code:</p>
          <div style="background: #111; border: 1px solid #00f0ff55; padding: 16px; text-align: center; border-radius: 4px; margin: 0 0 24px;">
            <span style="font-size: 32px; letter-spacing: 8px; color: #00f0ff; font-weight: bold;">${code}</span>
          </div>
          <p style="font-size: 12px; color: #666; margin: 0;">Expires in 10 minutes. If you didn't try to log in, change your password immediately.</p>
        </div>
      </div>
    `,
  });
  if (error) {
    await logEmail(to, "two_factor", "failed", null, error.message);
    throw new Error("Failed to send 2FA code");
  }
  await logEmail(to, "two_factor", "sent", data?.id);
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

/** Send the Grok Runner announcement email. Accepts optional custom subject/html and campaign id. */
export async function sendAnnouncementEmail(
  to: string,
  customSubject?: string,
  customHtml?: string,
  campaign: string = "announcement",
): Promise<boolean> {
  const fromAddress = getFromAddress();

  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: customSubject || `🚀 Grok Runner just got a massive upgrade`,
    html: customHtml || buildAnnouncementHtml(),
  });

  if (error) {
    await logEmail(to, campaign, "failed", null, error.message);
    console.error("[email] Failed to send announcement to", to, error.message);
    return false;
  }

  await logEmail(to, campaign, "sent", data?.id);
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

/** Build the v4.7 "coolest updates" announcement HTML. */
export function buildV47AnnouncementHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 540px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; text-align: center;">
          GROK RUNNER
        </h1>
        <p style="color: #ff00e599; font-size: 11px; letter-spacing: 5px; text-align: center; margin: 0 0 28px;">
          v4.7 // SYSTEM_DROP
        </p>

        <p style="font-size: 14px; color: #c0c0c0; line-height: 1.7; margin: 0 0 24px; text-align: center;">
          We've been shipping. Here's what's new since you last logged in.
        </p>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            🌍 LIVE COMMUNITY FEED
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            The social network for AI creators is here. Post your best gens, vote on others,
            comment, and follow your favorite Runners. Snap-scroll on mobile, Reddit-style ranking on desktop.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #ff00e544; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #ff00e5; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            💸 CREATOR MONETIZATION
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Lock posts, reels & stories behind credits, USD, or $XRGE. You keep <span style="color: #ff00e5; font-weight: bold;">75–80%</span>.
            Cash out in USD ($25 min) or convert to $XRGE instantly ($1 min). Verified creators get a checkmark.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #39ff1444; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #39ff14; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            🤖 AI CHARACTER CHAT
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Unfiltered conversations with AI personalities that have memory and vision.
            Ask them to generate images or videos mid-chat — they'll do it.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #ffaa0044; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #ffaa00; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            🎰 SPIN THE WHEEL + DAILY MISSIONS
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Free daily spin for credits. Complete 7-day mission cycles for a <span style="color: #ffaa00; font-weight: bold;">50-credit streak bonus</span>.
            Plus flash sales on $XRGE with stacking bonus multipliers.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            🔌 PUBLIC API + 🔐 2FA + 📱 TELEGRAM BOT
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Generate programmatically with the new <span style="color: #00f0ff;">/api/v1</span> endpoints.
            Lock your account with 2FA + trusted devices. Or skip the browser and run prompts straight from Telegram.
          </p>
        </div>

        <div style="background: #0d0d15; border: 1px solid #ff00e544; padding: 20px; border-radius: 4px; margin: 0 0 24px;">
          <h2 style="color: #ff00e5; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            🛡️ PRIVACY UPGRADE
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Delete a Library item and the file is purged from storage too.
            Take down your shared links with one click. Weekly orphan cleanup keeps your footprint minimal.
          </p>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            JACK IN →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          Sent to verified Grok Runner accounts. Your 10 daily credits are waiting.
        </p>
      </div>
    </div>
  `;
}

export function buildV48AnnouncementHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 540px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; text-align: center;">
          GROK RUNNER
        </h1>
        <p style="color: #ff00e599; font-size: 11px; letter-spacing: 5px; text-align: center; margin: 0 0 28px;">
          v4.8 // SIGNAL_BOOST
        </p>

        <div style="background: linear-gradient(135deg, #00f0ff15, #ff00e515); border: 1px solid #00f0ff66; padding: 18px; border-radius: 4px; margin: 0 0 24px; text-align: center;">
          <p style="color: #00f0ff; font-size: 12px; letter-spacing: 3px; margin: 0 0 6px;">+10 CREDITS DROPPED</p>
          <p style="font-size: 13px; color: #c0c0c0; margin: 0; line-height: 1.5;">
            Already in your wallet. Thanks for sticking around — go burn them on something weird.
          </p>
        </div>

        <p style="font-size: 14px; color: #c0c0c0; line-height: 1.7; margin: 0 0 24px; text-align: center;">
          Quick rundown of what just shipped:
        </p>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            💬 LIVE CHAT ROOMS
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Real-time topic channels (#general, #help, #showcase, #nsfw) baked into the app.
            Persistent message history, unread badges on the nav, and a one-tap entry from the bottom bar on mobile.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #ff00e544; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #ff00e5; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            🔒 LOCKED-POST CLARITY
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Creators now see exactly when a post is locked for other viewers, with the unlock price right on the card.
            Viewers see the same chip — no more guessing what something costs to peek.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #39ff1444; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #39ff14; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            🛡️ TIGHTER MODERATION
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Cleaner chat thanks to per-channel mutes and message takedowns running behind the scenes.
            Spam doesn't last long around here.
          </p>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app/chat" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            JOIN THE CHAT →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          Sent to verified Grok Runner accounts. Reply STOP to opt out of update emails.
        </p>
      </div>
    </div>
  `;
}

/**
 * Triggered from the Stripe webhook on checkout.session.completed for the
 * creator_verification flow. Idempotency-safe: webhook itself is idempotent.
 */
export async function sendVerificationPaymentReceiptEmail(
  to: string,
  opts: { amount?: string | null; subscriptionId?: string | null } = {},
): Promise<void> {
  const fromAddress = getFromAddress();
  const amount = opts.amount || "your verification fee";
  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: `Payment received — finish your creator verification`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">GROK RUNNER</h1>
          <p style="color: #00f0ff99; font-size: 11px; letter-spacing: 4px; margin: 0 0 20px;">PAYMENT RECEIPT // STEP 1 OF 2</p>

          <div style="background: #111; border: 1px solid #00f0ff55; padding: 18px; border-radius: 4px; margin: 0 0 20px;">
            <p style="font-size: 13px; color: #b0b0b0; margin: 0 0 6px;">Charged for ${amount}</p>
            <p style="font-size: 13px; color: #b0b0b0; margin: 0;">Monthly verification subscription started.</p>
          </div>

          <p style="font-size: 14px; color: #e0e0e0; margin: 0 0 12px;">
            ✅ One-time identity check fee received.
          </p>
          <p style="font-size: 13px; color: #a0a0a0; line-height: 1.6; margin: 0 0 20px;">
            Last step: complete the Stripe-hosted ID + selfie check. Once Stripe confirms,
            you'll get your blue check, can set prices on posts/stories, and unlock payouts.
          </p>

          <div style="text-align: center; margin: 0 0 20px;">
            <a href="https://grokrunner.gltch.app/verification" style="display: inline-block; background: #00f0ff22; border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 13px; letter-spacing: 3px; font-weight: bold;">
              FINISH ID CHECK →
            </a>
          </div>

          <p style="font-size: 11px; color: #555; margin: 0;">
            Manage or cancel the monthly verification subscription anytime in the Stripe customer portal.
            Verification is revoked immediately if the subscription lapses.
          </p>
        </div>
      </div>
    `,
  });

  if (error) {
    await logEmail(to, "verify_payment_receipt", "failed", null, error.message, opts);
    console.error("[email] Failed to send verification payment receipt:", error.message);
    return; // non-critical
  }
  await logEmail(to, "verify_payment_receipt", "sent", data?.id, null, opts);
}

/**
 * Send confirmation that Stripe Identity verification succeeded.
 * Triggered from the webhook on identity.verification_session.verified.
 */
export async function sendVerificationApprovedEmail(to: string): Promise<void> {
  const fromAddress = getFromAddress();
  const { data, error } = await getResend().emails.send({
    from: `Grok Runner <${fromAddress}>`,
    to: [to],
    subject: `You're a verified Grok Runner ✓`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #39ff1444; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 8px;">GROK RUNNER</h1>
          <p style="color: #39ff1499; font-size: 11px; letter-spacing: 4px; margin: 0 0 24px;">IDENTITY CONFIRMED // STEP 2 OF 2</p>

          <div style="background: #111; border: 1px solid #39ff1455; padding: 22px; text-align: center; border-radius: 4px; margin: 0 0 20px;">
            <div style="font-size: 36px; color: #39ff14; line-height: 1;">✓</div>
            <p style="font-size: 14px; color: #39ff14; letter-spacing: 3px; font-weight: bold; margin: 10px 0 0;">VERIFIED CREATOR</p>
          </div>

          <p style="font-size: 14px; color: #e0e0e0; margin: 0 0 12px;">
            You're in. Stripe confirmed your identity.
          </p>
          <p style="font-size: 13px; color: #a0a0a0; line-height: 1.7; margin: 0 0 20px;">
            What unlocks now:
          </p>
          <ul style="font-size: 13px; color: #b0b0b0; line-height: 1.8; padding-left: 18px; margin: 0 0 24px;">
            <li>Blue checkmark on your profile, posts, and stories</li>
            <li>Set prices on posts &amp; stories (credits, USD, or $XRGE)</li>
            <li>Request payouts ($25 USD min / $1 XRGE min)</li>
          </ul>

          <div style="text-align: center; margin: 0 0 20px;">
            <a href="https://grokrunner.gltch.app/profile" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #39ff1422); border: 1px solid #39ff1455; color: #39ff14; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-size: 13px; letter-spacing: 3px; font-weight: bold;">
              GO TO PROFILE →
            </a>
          </div>

          <p style="font-size: 11px; color: #555; margin: 0;">
            Verification stays active as long as your monthly subscription is current.
            View status anytime at /verification.
          </p>
        </div>
      </div>
    `,
  });

  if (error) {
    await logEmail(to, "verify_approved", "failed", null, error.message);
    console.error("[email] Failed to send verification approved email:", error.message);
    return;
  }
  await logEmail(to, "verify_approved", "sent", data?.id);
}

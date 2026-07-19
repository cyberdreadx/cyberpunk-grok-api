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
export async function logEmail(
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
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `Your verification code: ${code}`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">
            GLTCHRUNNER
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
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `Your login code: ${code}`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">GLTCHRUNNER</h1>
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
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `Password reset code: ${code}`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #ff00e533; padding: 24px; border-radius: 4px;">
          <h1 style="color: #ff00e5; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">
            GLTCHRUNNER
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
    from: `GLTCHRunner <${fromAddress}>`,
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

/** Send the GLTCHRunner announcement email. Accepts optional custom subject/html and campaign id. */
export async function sendAnnouncementEmail(
  to: string,
  customSubject?: string,
  customHtml?: string,
  campaign: string = "announcement",
): Promise<boolean> {
  const fromAddress = getFromAddress();

  const { data, error } = await getResend().emails.send({
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: customSubject || `🚀 GLTCHRunner just got a massive upgrade`,
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
          GLTCHRUNNER
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
            See what other GLTCHRunner creators are creating, get inspired, and connect with fellow creators.
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
            for AI creators. Post statuses, share your work in real-time, react to other GLTCHRunner creators' creations,
            and build your creative community. Stay tuned. 👀
          </p>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            LAUNCH GLTCHRUNNER →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          You're receiving this because you have a verified GLTCHRunner account.
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
          GLTCHRUNNER
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
          You're receiving this because you have a verified GLTCHRunner account.
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
          GLTCHRUNNER
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
          Sent to verified GLTCHRunner accounts. Your 10 daily credits are waiting.
        </p>
      </div>
    </div>
  `;
}

/** v4.9 — subscription credit fix + prompt board announcement. */
export function buildV49SubscriptionFixHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 540px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; text-align: center;">
          GLTCHRUNNER
        </h1>
        <p style="color: #ff00e599; font-size: 11px; letter-spacing: 5px; text-align: center; margin: 0 0 28px;">
          v4.9 // BILLING_PATCH + PROMPT_BOARD
        </p>

        <div style="background: linear-gradient(135deg, #39ff1415, #00f0ff15); border: 1px solid #39ff1466; padding: 18px; border-radius: 4px; margin: 0 0 24px; text-align: center;">
          <p style="color: #39ff14; font-size: 12px; letter-spacing: 3px; margin: 0 0 8px;">SUBSCRIPTION CREDITS — FIXED</p>
          <p style="font-size: 13px; color: #c0c0c0; margin: 0; line-height: 1.6;">
            We found and fixed a billing bug that was blocking monthly renewal credits for some long-time subscribers.
            If you're on a grandfathered plan, your credits are being restored — check your wallet.
          </p>
        </div>

        <p style="font-size: 14px; color: #c0c0c0; line-height: 1.7; margin: 0 0 20px;">
          Hey Runner — quick honest update. A Stripe API change silently broke our renewal webhook, so some subscribers
          weren't getting the monthly credits they paid for. That's on us, and we're sorry for the confusion.
        </p>

        <div style="background: #111; border: 1px solid #39ff1444; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #39ff14; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            ✅ WHAT WE FIXED
          </h2>
          <ul style="font-size: 13px; color: #b0b0b0; margin: 0; padding-left: 18px; line-height: 1.8;">
            <li>Renewal webhooks now correctly detect subscription invoices again</li>
            <li>Grandfathered / legacy subscription prices get their monthly credits back</li>
            <li>Missing credits from recent renewals are being backfilled</li>
          </ul>
        </div>

        <div style="background: #111; border: 1px solid #ffaa0044; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #ffaa00; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            ℹ️ NEW PRICING MODEL
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            New subscription tiers focus on <span style="color: #ffaa00; font-weight: bold;">discount %</span> on credit packs
            instead of monthly credit drops. If you subscribed before the change, you're grandfathered — you keep your monthly credits.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            💡 NEW: PROMPT BOARD
          </h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.6;">
            Share your best prompts, vote on what works, and copy winning setups straight into the generator.
            Community knowledge, ranked.
          </p>
        </div>

        <div style="background: #0d0d15; border: 1px solid #ff00e544; padding: 16px; border-radius: 4px; margin: 0 0 24px;">
          <p style="font-size: 12px; color: #909090; margin: 0; line-height: 1.6;">
            Still missing credits after a recent renewal? Reply to this email or hit support in-app — include the email on your account
            and we'll look at your Stripe history manually.
          </p>
        </div>

        <div style="text-align: center; margin: 0 0 12px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            OPEN GLTCHRUNNER →
          </a>
        </div>
        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app/prompts" style="font-size: 12px; color: #00f0ff99; text-decoration: underline;">
            Browse the Prompt Board →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          Sent to verified GLTCHRunner accounts. Your 10 daily credits are still waiting.
        </p>
      </div>
    </div>
  `;
}

export function buildV52AnnouncementHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 540px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; text-align: center;">
          GLTCHRUNNER
        </h1>
        <p style="color: #ff00e599; font-size: 11px; letter-spacing: 5px; text-align: center; margin: 0 0 28px;">
          v5.2 // INFRASTRUCTURE_UPGRADE
        </p>

        <div style="background: linear-gradient(135deg, #39ff1415, #00f0ff15); border: 1px solid #39ff1466; padding: 18px; border-radius: 4px; margin: 0 0 24px; text-align: center;">
          <p style="color: #39ff14; font-size: 12px; letter-spacing: 3px; margin: 0 0 8px;">BACKEND UPGRADED</p>
          <p style="font-size: 13px; color: #c0c0c0; margin: 0; line-height: 1.6;">
            GLTCH Runner is now running on a dedicated self-hosted server. Faster responses, no cold start timeouts, and full infrastructure control.
          </p>
        </div>

        <p style="font-size: 14px; color: #c0c0c0; line-height: 1.7; margin: 0 0 20px;">
          Hey Runner — quick update. We've moved the backend off Vercel onto our own server at <span style="color: #00f0ff;">api.gltch.app</span>.
          This means no more function timeouts on long generations, faster API responses, and total control over uptime and reliability.
        </p>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            ⚡ WHAT'S IMPROVED
          </h2>
          <ul style="font-size: 13px; color: #b0b0b0; margin: 0; padding-left: 18px; line-height: 1.8;">
            <li>Self-hosted backend — no Vercel function limits or cold starts</li>
            <li>Faster image &amp; video generation API responses</li>
            <li>All cron jobs (daily credits, story cleanup, email campaigns) run on-server 24/7</li>
            <li>Auto-restart on crash or server reboot via systemd</li>
          </ul>
        </div>

        <div style="background: #111; border: 1px solid #ff00e544; padding: 20px; border-radius: 4px; margin: 0 0 24px;">
          <h2 style="color: #ff00e5; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            💬 ALSO IN v5.1
          </h2>
          <ul style="font-size: 13px; color: #b0b0b0; margin: 0; padding-left: 18px; line-height: 1.8;">
            <li>Chat room — #general, #help, #showcase, #nsfw channels in the More menu</li>
            <li>Trash purge now deletes files from storage too, not just the DB</li>
            <li>Owner-side locked post badges on your profile grid</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            OPEN GLTCHRUNNER →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          Sent to verified GltchRunner accounts. Your daily credits are still waiting.
        </p>
      </div>
    </div>
  `;
}

export function buildCrackdownAnnouncementHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 540px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; text-align: center;">
          GLTCHRUNNER
        </h1>
        <p style="color: #ff00e599; font-size: 11px; letter-spacing: 5px; text-align: center; margin: 0 0 28px;">
          SYSTEM_PURGE // COMPLETE
        </p>

        <div style="background: linear-gradient(135deg, #ff3b3b15, #00f0ff15); border: 1px solid #ff3b3b66; padding: 18px; border-radius: 4px; margin: 0 0 24px; text-align: center;">
          <p style="color: #ff5b5b; font-size: 12px; letter-spacing: 3px; margin: 0 0 8px;">🧹 CREDIT FARMERS — BANNED</p>
          <p style="font-size: 13px; color: #c0c0c0; margin: 0; line-height: 1.6;">
            We've purged the fake-account rings that were draining GPU time from real Runners. Banned, blocked, and locked out.
          </p>
        </div>

        <p style="font-size: 14px; color: #c0c0c0; line-height: 1.7; margin: 0 0 20px;">
          Hey Runner — real talk. For the past few months, credit-farming rings were mass-creating fake accounts with throwaway emails to drain free credits and burn GPU time. That's why queues felt slower and generations sometimes lagged. It wasn't you — it was them.
        </p>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 24px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            ⚡ WHAT WE DID
          </h2>
          <ul style="font-size: 13px; color: #b0b0b0; margin: 0; padding-left: 18px; line-height: 1.8;">
            <li><strong style="color:#ff5b5b;">Banned the farm accounts</strong> — and anyone still farming will get the same</li>
            <li><strong style="color:#fff;">New signup defenses</strong> — throwaway/burner email domains are auto-blocked at the door</li>
            <li><strong style="color:#fff;">Smarter abuse detection</strong> — delete-and-recreate credit cycling no longer works</li>
            <li><strong style="color:#fff;">GPU freed up</strong> — that compute goes back to real Runners</li>
          </ul>
        </div>

        <div style="background: #111; border: 1px solid #ff00e544; padding: 20px; border-radius: 4px; margin: 0 0 24px;">
          <h2 style="color: #ff00e5; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">🚀 WHAT IT MEANS FOR YOU</h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.7;">
            Faster queues, snappier generations, and free credits that actually go to the community they were meant for. Smooth sailing from here — thanks for riding it out with us.
          </p>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            OPEN GLTCHRUNNER →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          Sent to verified GltchRunner accounts. Your daily credits are still waiting.
        </p>
      </div>
    </div>
  `;
}

export function buildV53AnnouncementHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 540px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; text-align: center;">
          GLTCHRUNNER
        </h1>
        <p style="color: #ff00e599; font-size: 11px; letter-spacing: 5px; text-align: center; margin: 0 0 28px;">
          v5.3 // SOUND_ON
        </p>

        <div style="background: linear-gradient(135deg, #fbbf2415, #00f0ff15); border: 1px solid #fbbf2466; padding: 18px; border-radius: 4px; margin: 0 0 24px; text-align: center;">
          <p style="color: #fbbf24; font-size: 12px; letter-spacing: 3px; margin: 0 0 8px;">🎬 NEW ENGINE — LTX-2.3 WITH SOUND</p>
          <p style="font-size: 13px; color: #c0c0c0; margin: 0; line-height: 1.6;">
            Generate video <strong style="color:#fff;">with native synced audio</strong> in a single pass — text-to-video and image-to-video. No separate sound step.
          </p>
        </div>

        <p style="font-size: 14px; color: #c0c0c0; line-height: 1.7; margin: 0 0 20px;">
          Hey Runner — our new <span style="color: #fbbf24;">LTX-2.3</span> engine makes video with sound baked in. Pick your clip length, hit generate, and the audio comes with it.
        </p>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 24px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">
            ⚡ WHAT'S NEW
          </h2>
          <ul style="font-size: 13px; color: #b0b0b0; margin: 0; padding-left: 18px; line-height: 1.8;">
            <li><strong style="color:#fbbf24;">LTX-2.3</strong> — video + native sound in one pass, sharper renders</li>
            <li><strong style="color:#fff;">Pick your length</strong> — 2–7 second clips, priced per second (7 cr/s)</li>
            <li><strong style="color:#fff;">🔊 Sound everywhere</strong> — unmute videos in the feed reels, your library, and stories</li>
            <li>Optional ambient sound still available on WAN video</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            OPEN GLTCHRUNNER →
          </a>
        </div>

        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          Sent to verified GltchRunner accounts. Your daily credits are still waiting.
        </p>
      </div>
    </div>
  `;
}

export function buildLaunchAnnouncementHtml(): string {
  return `
    <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 540px; margin: 0 auto;">
      <div style="border: 1px solid #00f0ff33; padding: 28px; border-radius: 4px;">

        <h1 style="color: #00f0ff; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; text-align: center;">
          GLTCH RUNNER
        </h1>
        <p style="color: #ff00e599; font-size: 11px; letter-spacing: 5px; text-align: center; margin: 0 0 28px;">
          NEW ERA // SAME ACCOUNT
        </p>

        <div style="background: linear-gradient(135deg, #ff00e515, #00f0ff15); border: 1px solid #00f0ff66; padding: 18px; border-radius: 4px; margin: 0 0 24px; text-align: center;">
          <p style="color: #00f0ff; font-size: 12px; letter-spacing: 3px; margin: 0 0 8px;">WE'RE NOW GLTCH RUNNER</p>
          <p style="font-size: 13px; color: #c0c0c0; margin: 0; line-height: 1.6;">
            Same login, same credits — bigger, faster, and fewer limits. Here's what's new.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #ff00e544; padding: 20px; border-radius: 4px; margin: 0 0 16px;">
          <h2 style="color: #ff00e5; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">💬 CHAT WITH AI MODELS</h2>
          <p style="font-size: 13px; color: #b0b0b0; margin: 0; line-height: 1.7;">
            Our featured models now have AI personas you can message — they reply in character and send photos &amp; videos on request. Find them on the feed and the MODELS tab.
          </p>
        </div>

        <div style="background: #111; border: 1px solid #00f0ff44; padding: 20px; border-radius: 4px; margin: 0 0 24px;">
          <h2 style="color: #00f0ff; font-size: 15px; margin: 0 0 10px; letter-spacing: 1px;">⚡ WHAT'S NEW</h2>
          <ul style="font-size: 13px; color: #b0b0b0; margin: 0; padding-left: 18px; line-height: 1.8;">
            <li>AI image generation &amp; editing — GLTCH + GLTCH PRO engines, fewer restrictions</li>
            <li>Text-to-video &amp; image-to-video (WAN + Seedance)</li>
            <li>Featured creators you can chat with, unlock, and tip</li>
            <li>Trending / Following feed sorting</li>
            <li>Faster self-hosted backend — no timeouts or cold starts</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="https://grokrunner.gltch.app" style="display: inline-block; background: linear-gradient(135deg, #00f0ff22, #ff00e522); border: 1px solid #00f0ff55; color: #00f0ff; text-decoration: none; padding: 14px 36px; border-radius: 4px; font-size: 14px; letter-spacing: 3px; font-weight: bold;">
            OPEN GLTCH RUNNER →
          </a>
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin: 0 0 6px;">
          New here? <a href="https://gltchrunner.com" style="color: #00f0ff; text-decoration: underline;">gltchrunner.com</a>
        </p>
        <p style="font-size: 11px; color: #444; margin: 0; text-align: center;">
          Sent to verified GLTCH Runner accounts. Your daily credits are still waiting.
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
          GLTCHRUNNER
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
          Sent to verified GLTCHRunner accounts. Reply STOP to opt out of update emails.
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
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `Payment received — finish your creator verification`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 16px;">GLTCHRUNNER</h1>
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
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `You're a verified GLTCHRunner ✓`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #39ff1444; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 18px; letter-spacing: 3px; margin: 0 0 8px;">GLTCHRUNNER</h1>
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

const fmtUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Notify the admin that a creator requested a (manual) fiat payout. */
export async function sendPayoutRequestedAdminEmail(
  to: string,
  info: { username: string; amountCents: number; method: string; payoutDetails: string; requestId: string },
): Promise<void> {
  const fromAddress = getFromAddress();
  const { data, error } = await getResend().emails.send({
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `Payout request: ${fmtUsd(info.amountCents)} (${info.method}) — @${info.username}`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #00f0ff33; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 16px; letter-spacing: 3px; margin: 0 0 16px;">PAYOUT REQUEST</h1>
          <p style="font-size: 14px; color: #e0e0e0; margin: 0 0 8px;">@${info.username} requested a payout.</p>
          <table style="font-size: 13px; color: #b0b0b0; line-height: 1.9; margin: 0 0 20px;">
            <tr><td style="color:#666;padding-right:12px;">Amount</td><td style="color:#39ff14;">${fmtUsd(info.amountCents)}</td></tr>
            <tr><td style="color:#666;padding-right:12px;">Method</td><td>${info.method}</td></tr>
            <tr><td style="color:#666;padding-right:12px;vertical-align:top;">Details</td><td>${(info.payoutDetails || "—").replace(/</g, "&lt;")}</td></tr>
          </table>
          <a href="https://grokrunner.gltch.app/admin" style="display:inline-block; background:#00f0ff22; border:1px solid #00f0ff55; color:#00f0ff; text-decoration:none; padding:12px 28px; border-radius:4px; font-size:12px; letter-spacing:2px;">REVIEW IN ADMIN →</a>
          <p style="font-size: 11px; color: #555; margin: 18px 0 0;">Request ${info.requestId}</p>
        </div>
      </div>
    `,
  });
  if (error) {
    await logEmail(to, "payout_requested", "failed", null, error.message);
    console.error("[email] payout requested:", error.message);
    return;
  }
  await logEmail(to, "payout_requested", "sent", data?.id);
}

/** Notify the creator that their payout was marked paid. */
export async function sendPayoutPaidEmail(to: string, info: { amountCents: number; method: string }): Promise<void> {
  const fromAddress = getFromAddress();
  const { data, error } = await getResend().emails.send({
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `Payout sent: ${fmtUsd(info.amountCents)} 💸`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #39ff1444; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 16px; letter-spacing: 3px; margin: 0 0 8px;">GLTCHRUNNER</h1>
          <p style="color: #39ff1499; font-size: 11px; letter-spacing: 4px; margin: 0 0 20px;">PAYOUT SENT</p>
          <div style="background:#111; border:1px solid #39ff1455; padding:20px; text-align:center; border-radius:4px; margin:0 0 18px;">
            <div style="font-size: 28px; color:#39ff14; font-weight:bold;">${fmtUsd(info.amountCents)}</div>
            <p style="font-size:12px; color:#888; margin:6px 0 0;">via ${info.method}</p>
          </div>
          <p style="font-size: 13px; color: #b0b0b0; line-height:1.7; margin: 0 0 16px;">
            Your payout has been processed. Depending on your method it may take a little time to land. Keep creating! 🚀
          </p>
          <a href="https://grokrunner.gltch.app/profile" style="display:inline-block; background:#39ff1422; border:1px solid #39ff1455; color:#39ff14; text-decoration:none; padding:12px 28px; border-radius:4px; font-size:12px; letter-spacing:2px;">VIEW EARNINGS →</a>
        </div>
      </div>
    `,
  });
  if (error) {
    await logEmail(to, "payout_paid", "failed", null, error.message);
    console.error("[email] payout paid:", error.message);
    return;
  }
  await logEmail(to, "payout_paid", "sent", data?.id);
}

/** Notify the creator that their payout was rejected (balance refunded). */
export async function sendPayoutRejectedEmail(to: string, info: { amountCents: number; note?: string | null }): Promise<void> {
  const fromAddress = getFromAddress();
  const { data, error } = await getResend().emails.send({
    from: `GLTCHRunner <${fromAddress}>`,
    to: [to],
    subject: `Payout request needs attention`,
    html: `
      <div style="font-family: 'Courier New', monospace; background: #0a0a0f; color: #e0e0e0; padding: 32px; max-width: 480px; margin: 0 auto;">
        <div style="border: 1px solid #ff444444; padding: 24px; border-radius: 4px;">
          <h1 style="color: #00f0ff; font-size: 16px; letter-spacing: 3px; margin: 0 0 16px;">PAYOUT NOT PROCESSED</h1>
          <p style="font-size: 13px; color: #b0b0b0; line-height:1.7; margin: 0 0 12px;">
            Your payout request for <strong style="color:#e0e0e0;">${fmtUsd(info.amountCents)}</strong> couldn't be processed and your balance has been refunded.
          </p>
          ${info.note ? `<p style="font-size:12px; color:#ffae00; background:#1a1205; border:1px solid #ffae0033; padding:12px; border-radius:4px; margin:0 0 16px;">${info.note.replace(/</g, "&lt;")}</p>` : ""}
          <a href="https://grokrunner.gltch.app/profile" style="display:inline-block; background:#00f0ff22; border:1px solid #00f0ff55; color:#00f0ff; text-decoration:none; padding:12px 28px; border-radius:4px; font-size:12px; letter-spacing:2px;">TRY AGAIN →</a>
        </div>
      </div>
    `,
  });
  if (error) {
    await logEmail(to, "payout_rejected", "failed", null, error.message);
    console.error("[email] payout rejected:", error.message);
    return;
  }
  await logEmail(to, "payout_rejected", "sent", data?.id);
}

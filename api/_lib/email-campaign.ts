/**
 * Reliable bulk email campaigns via Resend batch API + email_log dedup.
 * Designed for cron-driven processing (no fragile self-fetch chains).
 */

import { unsubUrl } from "./notification-prefs";
import { getResend, getFromAddress, logEmail, buildAnnouncementHtml, buildV47AnnouncementHtml, buildV48AnnouncementHtml, buildV49SubscriptionFixHtml, buildV52AnnouncementHtml, buildV53AnnouncementHtml, buildV55AnnouncementHtml, buildV56AnnouncementHtml, buildLaunchAnnouncementHtml, buildCrackdownAnnouncementHtml } from "./email";

export const CAMPAIGN_CONFIG_KEY = "active_email_campaign";

export interface CampaignJob {
  campaign: string;
  subject: string;
  html?: string | null;
  status: "active" | "complete" | "cancelled";
  startedAt: string;
  batchSize: number;
  lastBatchAt?: string;
  totalSent?: number;
  totalFailed?: number;
}

export const DEFAULT_CAMPAIGN_SUBJECTS: Record<string, string> = {
  announcement: "GLTCHRunner Update — New Features & Improvements",
  announcement_v47: "GLTCHRunner Update — v4.7 is Live",
  announcement_v48: "GLTCHRunner Update — v4.8 is Live",
  announcement_v49: "GLTCHRunner — Subscription Credits Fixed + Platform Update",
  announcement_v52: "⚡ GLTCHRunner v5.2 — Faster & More Reliable Than Ever",
  announcement_v53: "🔊 GLTCHRunner v5.3 — LTX video with SOUND is live",
  announcement_v55: "🎬 GLTCHRunner v5.5 — video thumbnails fixed + text posts",
  announcement_v56: "✨ GLTCHRunner v5.6 — new Krea 2 engine + sharper video",
  announcement_launch: "🚀 GLTCH Runner is here — chat with AI models + video gen",
  announcement_crackdown: "🧹 GLTCHRunner — Credit farmers banned, full speed restored",
};

export function getAnnouncementHtmlForCampaign(campaign: string): string {
  switch (campaign) {
    case "announcement_v47":
      return buildV47AnnouncementHtml();
    case "announcement_v48":
      return buildV48AnnouncementHtml();
    case "announcement_v49":
      return buildV49SubscriptionFixHtml();
    case "announcement_v52":
      return buildV52AnnouncementHtml();
    case "announcement_v53":
      return buildV53AnnouncementHtml();
    case "announcement_v55":
      return buildV55AnnouncementHtml();
    case "announcement_v56":
      return buildV56AnnouncementHtml();
    case "announcement_launch":
      return buildLaunchAnnouncementHtml();
    case "announcement_crackdown":
      return buildCrackdownAnnouncementHtml();
    default:
      return buildAnnouncementHtml();
  }
}

export function getDefaultSubject(campaign: string): string {
  return DEFAULT_CAMPAIGN_SUBJECTS[campaign] ?? DEFAULT_CAMPAIGN_SUBJECTS.announcement;
}

export async function getCampaignRemaining(
  sql: ReturnType<typeof import("./db").getDb>,
  campaign: string,
): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM users u
    LEFT JOIN notification_prefs p ON p.user_id = u.id
    WHERE u.email_verified = true
      -- Same opt-out filter as getCampaignRecipients, or the progress readout
      -- never reaches zero and the batch loop keeps looking for people who
      -- will never be selected.
      AND COALESCE(p.email_enabled, true) = true
      AND u.email NOT IN (
        SELECT recipient FROM email_log
        WHERE email_type = ${campaign} AND status = 'sent'
      )
  `;
  return (rows[0] as { count: number }).count;
}

export async function getCampaignRecipients(
  sql: ReturnType<typeof import("./db").getDb>,
  campaign: string,
  limit: number,
): Promise<{ id: string; email: string }[]> {
  const rows = await sql`
    SELECT u.id, u.email
    FROM users u
    LEFT JOIN notification_prefs p ON p.user_id = u.id
    WHERE u.email_verified = true
      -- Respect the opt-out. This clause was missing: migration 052 added
      -- notification_prefs precisely because CAN-SPAM requires a working
      -- opt-out, but campaigns never consulted it, so anyone who switched
      -- email off still received every announcement. Absent row = opted in.
      AND COALESCE(p.email_enabled, true) = true
      AND u.email NOT IN (
        SELECT recipient FROM email_log
        WHERE email_type = ${campaign} AND status = 'sent'
      )
    ORDER BY u.created_at ASC
    LIMIT ${limit}
  `;
  return rows.map((r: { id: string; email: string }) => ({ id: r.id, email: r.email }));
}

export async function isCampaignCancelled(
  sql: ReturnType<typeof import("./db").getDb>,
  campaign: string,
): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM announcement_cancels WHERE campaign = ${campaign} LIMIT 1
  `;
  return rows.length > 0;
}

export async function readActiveCampaign(
  sql: ReturnType<typeof import("./db").getDb>,
): Promise<CampaignJob | null> {
  const rows = await sql`
    SELECT value FROM app_config WHERE key = ${CAMPAIGN_CONFIG_KEY} LIMIT 1
  `;
  if (!rows.length) return null;
  const raw = (rows[0] as { value: unknown }).value;
  if (!raw || typeof raw !== "object") return null;
  const job = raw as CampaignJob;
  if (job.status !== "active") return null;
  return job;
}

export async function saveCampaignJob(
  sql: ReturnType<typeof import("./db").getDb>,
  job: CampaignJob,
): Promise<void> {
  await sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (${CAMPAIGN_CONFIG_KEY}, ${JSON.stringify(job)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function clearCampaignJob(
  sql: ReturnType<typeof import("./db").getDb>,
): Promise<void> {
  await sql`DELETE FROM app_config WHERE key = ${CAMPAIGN_CONFIG_KEY}`;
}

export interface BatchResult {
  sent: number;
  failed: number;
  remaining: number;
  cancelled: boolean;
  complete: boolean;
}

/**
 * Visible unsubscribe line appended to every campaign email.
 *
 * The List-Unsubscribe header covers Gmail/Yahoo's native button, but CAN-SPAM
 * wants a link a person can actually see and click, and plenty of clients show
 * no native button at all.
 */
function unsubFooter(url: string): string {
  return `
    <div style="font-family:'Courier New',monospace;max-width:540px;margin:0 auto;padding:0 32px 28px;text-align:center;">
      <p style="font-size:11px;color:#555;line-height:1.6;margin:0;">
        You're receiving this because you have a verified GLTCH Runner account.<br>
        <a href="${url}" style="color:#666;text-decoration:underline;">Unsubscribe from these emails</a>
      </p>
    </div>`;
}

/** Send one batch via Resend batch API and log each recipient. */
export async function processCampaignBatch(
  sql: ReturnType<typeof import("./db").getDb>,
  job: CampaignJob,
): Promise<BatchResult> {
  const campaign = job.campaign;

  if (await isCampaignCancelled(sql, campaign)) {
    await saveCampaignJob(sql, { ...job, status: "cancelled" });
    return { sent: 0, failed: 0, remaining: 0, cancelled: true, complete: true };
  }

  const batchSize = Math.min(Math.max(job.batchSize || 50, 1), 100);
  const recipients = await getCampaignRecipients(sql, campaign, batchSize);

  if (recipients.length === 0) {
    await saveCampaignJob(sql, { ...job, status: "complete", lastBatchAt: new Date().toISOString() });
    return { sent: 0, failed: 0, remaining: 0, cancelled: false, complete: true };
  }

  const subject = job.subject || getDefaultSubject(campaign);
  const html = job.html || getAnnouncementHtmlForCampaign(campaign);
  const resend = getResend();
  const from = getFromAddress();

  // Every campaign until now went out with no unsubscribe link and no
  // List-Unsubscribe header, to ~25k recipients at a time. That is a CAN-SPAM
  // problem and, since Gmail and Yahoo's 2024 bulk-sender rules, a
  // deliverability one: RFC 8058 one-click is expected of anyone sending at
  // this volume, and its absence pushes the whole domain toward spam.
  // api/unsubscribe.ts already implements both GET and one-click POST — the
  // campaign path simply never called it.
  const payload = recipients.map(({ id, email }) => {
    const unsub = unsubUrl(id, "*");
    return {
      from: `GLTCHRunner <${from}>`,
      to: [email],
      subject,
      html: `${html}${unsubFooter(unsub)}`,
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [{ name: "campaign", value: campaign }],
    };
  });

  let sent = 0;
  let failed = 0;

  try {
    const { data, error } = await resend.batch.send(payload);

    if (error) {
      for (const { email } of recipients) {
        await logEmail(email, campaign, "failed", null, error.message);
        failed++;
      }
    } else {
      // Resend's batch.send resolves to { data: { data: [{ id }] }, error } —
      // the per-item array is nested under `data.data`. The old code read
      // `data[i]` (indexing the wrapper object), so resendId was always
      // undefined and every recipient was logged "failed". Since the dedup
      // query (getCampaignRecipients) only excludes status='sent', the same
      // oldest-N recipients were re-selected and re-delivered on every 2-min
      // cron run — the "20 copies" bug. Read the nested array, and because
      // error===null means Resend accepted the whole batch, log "sent"
      // regardless of per-item id so the dedup always advances (loop-proof).
      const ids = (data?.data ?? []) as Array<{ id?: string }>;
      for (let i = 0; i < recipients.length; i++) {
        const { email } = recipients[i];
        await logEmail(email, campaign, "sent", ids[i]?.id ?? null);
        sent++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const { email } of recipients) {
      await logEmail(email, campaign, "failed", null, msg);
      failed++;
    }
  }

  const remaining = await getCampaignRemaining(sql, campaign);
  const complete = remaining === 0;

  await saveCampaignJob(sql, {
    ...job,
    status: complete ? "complete" : "active",
    lastBatchAt: new Date().toISOString(),
    totalSent: (job.totalSent ?? 0) + sent,
    totalFailed: (job.totalFailed ?? 0) + failed,
  });

  return { sent, failed, remaining, cancelled: false, complete };
}

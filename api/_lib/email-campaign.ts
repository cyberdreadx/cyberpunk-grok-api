/**
 * Reliable bulk email campaigns via Resend batch API + email_log dedup.
 * Designed for cron-driven processing (no fragile self-fetch chains).
 */

import { getResend, getFromAddress, logEmail, buildAnnouncementHtml, buildV47AnnouncementHtml, buildV48AnnouncementHtml, buildV49SubscriptionFixHtml, buildV52AnnouncementHtml } from "./email";

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
  announcement_v52: "⚡ GrokRunner v5.2 — Faster & More Reliable Than Ever",
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
    WHERE u.email_verified = true
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
): Promise<string[]> {
  const rows = await sql`
    SELECT u.email
    FROM users u
    WHERE u.email_verified = true
      AND u.email NOT IN (
        SELECT recipient FROM email_log
        WHERE email_type = ${campaign} AND status = 'sent'
      )
    ORDER BY u.created_at ASC
    LIMIT ${limit}
  `;
  return rows.map((r: { email: string }) => r.email);
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

  const payload = recipients.map((to) => ({
    from: `GLTCHRunner <${from}>`,
    to: [to],
    subject,
    html,
    tags: [{ name: "campaign", value: campaign }],
  }));

  let sent = 0;
  let failed = 0;

  try {
    const { data, error } = await resend.batch.send(payload);

    if (error) {
      for (const email of recipients) {
        await logEmail(email, campaign, "failed", null, error.message);
        failed++;
      }
    } else {
      const ids = data ?? [];
      for (let i = 0; i < recipients.length; i++) {
        const email = recipients[i];
        const resendId = ids[i]?.id ?? null;
        if (resendId) {
          await logEmail(email, campaign, "sent", resendId);
          sent++;
        } else {
          await logEmail(email, campaign, "failed", null, "No Resend ID returned for batch item");
          failed++;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const email of recipients) {
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

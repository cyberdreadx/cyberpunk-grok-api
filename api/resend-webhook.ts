/**
 * Resend Webhook Endpoint
 * Receives bounce, complaint, and delivery events from Resend
 * and updates the email_log table accordingly.
 *
 * Set RESEND_WEBHOOK_SECRET in env to verify webhook signatures.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import crypto from "crypto";

const RELEVANT_EVENTS = new Set([
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.delivery_delayed",
]);

const EVENT_TO_STATUS: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delayed",
};

function verifySignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    // Verify webhook signature if secret is configured
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (secret) {
      const signature =
        (req.headers["svix-signature"] as string) ||
        (req.headers["resend-signature"] as string) ||
        null;

      if (!verifySignature(rawBody, signature, secret)) {
        console.error("[resend-webhook] Invalid signature");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    const event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventType: string = event.type;

    if (!RELEVANT_EVENTS.has(eventType)) {
      // Acknowledge but ignore irrelevant events
      return res.status(200).json({ ignored: true, type: eventType });
    }

    const data = event.data;
    const resendId: string | null = data?.email_id || data?.id || null;
    const recipient: string | null =
      data?.to?.[0] || data?.email?.to?.[0] || null;
    const newStatus = EVENT_TO_STATUS[eventType] || eventType;

    if (!resendId) {
      console.warn("[resend-webhook] No email ID in event:", eventType);
      return res.status(200).json({ skipped: true, reason: "no_email_id" });
    }

    const sql = getDb();

    // Update existing email_log entry by resend_id
    const updated = await sql`
      UPDATE email_log
      SET status = ${newStatus},
          error_message = CASE
            WHEN ${newStatus} = 'bounced' THEN ${data?.bounce?.message || data?.reason || 'Bounced'}
            WHEN ${newStatus} = 'complained' THEN 'Recipient marked as spam'
            ELSE error_message
          END,
          metadata = metadata || ${JSON.stringify({
            webhook_event: eventType,
            webhook_received_at: new Date().toISOString(),
            ...(data?.bounce ? { bounce: data.bounce } : {}),
            ...(data?.complaint ? { complaint: data.complaint } : {}),
          })}::jsonb
      WHERE resend_id = ${resendId}
      RETURNING id
    `;

    // If no matching row found, insert a new log entry
    if (!updated || updated.length === 0) {
      await sql`
        INSERT INTO email_log (recipient, email_type, resend_id, status, error_message, metadata)
        VALUES (
          ${recipient || 'unknown'},
          'webhook',
          ${resendId},
          ${newStatus},
          ${newStatus === 'bounced' ? (data?.bounce?.message || data?.reason || 'Bounced') : null},
          ${JSON.stringify({
            webhook_event: eventType,
            webhook_received_at: new Date().toISOString(),
            full_event: data,
          })}::jsonb
        )
      `;
    }

    console.log(
      `[resend-webhook] ${eventType} processed for ${resendId} → ${newStatus}`,
    );
    return res.status(200).json({ processed: true, status: newStatus });
  } catch (err: any) {
    console.error("[resend-webhook] Error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

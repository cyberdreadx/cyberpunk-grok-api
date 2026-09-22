/**
 * Resend webhook — delivery and engagement events.
 *
 * Receives sent/delivered/bounced/complained/delayed/opened/clicked events,
 * records them, and stops mailing addresses that hard-bounce or report spam.
 *
 * Two things were wrong with the original and are worth stating, because both
 * would have fired the moment the secret was configured:
 *
 * 1. The signature check could never pass. Resend signs through Svix: the HMAC
 *    covers `${svix-id}.${svix-timestamp}.${body}` and is sent base64 in a
 *    `v1,<sig>` list. The old code hashed the body alone, in hex, and compared
 *    it to the raw header — so every genuine event would have been rejected as
 *    a forgery, and the endpoint would have looked "enabled but silent".
 *
 * 2. It wrote the event into `email_log.status`. The campaign sender dedupes on
 *    `status = 'sent'` (email-campaign.ts getCampaignRecipients), so an
 *    `email.delivered` event flipping a row to 'delivered' would have made an
 *    already-mailed person eligible again and sent them a second copy of the
 *    campaign. Status is now never touched; events live in `email_events`.
 *
 * Set RESEND_WEBHOOK_SECRET (the `whsec_…` value Resend shows when you create
 * the endpoint) to switch it on. Without it the endpoint refuses everything.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/db";
import crypto from "crypto";

/** Events we store. Anything else is acknowledged and ignored. */
const EVENT_NAMES: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

/** Svix rejects anything older than this, to stop a captured request being replayed. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * The secret is `whsec_` + base64 key material, and the HMAC is over the raw
 * key bytes — not over the printable string. A secret without the prefix is
 * treated as raw utf8 so a hand-made test secret still works.
 */
function secretKey(secret: string): Buffer {
  const bare = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const decoded = Buffer.from(bare, "base64");
  return decoded.length > 0 ? decoded : Buffer.from(bare, "utf8");
}

function verifySvix(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
): { ok: boolean; reason?: string } {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };

  const expected = crypto
    .createHmac("sha256", secretKey(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const expBuf = Buffer.from(expected);

  // The header carries a space-separated list ("v1,<sig> v1,<older sig>") so a
  // secret can be rotated without dropping events mid-flight.
  for (const part of signature.split(" ")) {
    const sig = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) return { ok: true };
  }
  return { ok: false, reason: "signature_mismatch" };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // server/index.ts parses this route with express.text, so req.body is the
    // exact bytes Resend signed. Re-serialising a parsed object would reorder
    // keys and break the HMAC.
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not configured — rejecting");
      return res.status(503).json({ error: "Webhook not configured" });
    }

    const svixId = (req.headers["svix-id"] as string) || null;
    const svixTimestamp = (req.headers["svix-timestamp"] as string) || null;
    const svixSignature =
      (req.headers["svix-signature"] as string) || (req.headers["resend-signature"] as string) || null;

    const verdict = verifySvix(rawBody, { id: svixId, timestamp: svixTimestamp, signature: svixSignature }, secret);
    if (!verdict.ok) {
      console.error(`[resend-webhook] rejected: ${verdict.reason}`);
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody);
    const eventType: string = event?.type;
    const name = EVENT_NAMES[eventType];
    if (!name) return res.status(200).json({ ignored: true, type: eventType });

    const data = event?.data ?? {};
    const resendId: string | null = data.email_id || data.id || null;
    const recipient: string | null = data.to?.[0] || data.email?.to?.[0] || null;
    const link: string | null = data.click?.link || data.link || null;

    if (!recipient && !resendId) {
      return res.status(200).json({ skipped: true, reason: "no_recipient" });
    }

    const sql = getDb();

    // Attribute the event to the campaign that sent it.
    let emailType: string | null = null;
    if (resendId) {
      const rows = (await sql`SELECT email_type FROM email_log WHERE resend_id = ${resendId} LIMIT 1`) as any[];
      emailType = rows[0]?.email_type ?? null;
    }
    if (!emailType && recipient) {
      const rows = (await sql`
        SELECT email_type FROM email_log
        WHERE lower(recipient) = lower(${recipient}) ORDER BY created_at DESC LIMIT 1`) as any[];
      emailType = rows[0]?.email_type ?? null;
    }

    // Svix retries until it gets a 2xx. The unique svix_id makes a retry a
    // no-op instead of a duplicate click.
    const inserted = (await sql`
      INSERT INTO email_events (svix_id, resend_id, recipient, email_type, event, link, payload)
      VALUES (
        ${svixId},
        ${resendId},
        ${recipient ?? "unknown"},
        ${emailType},
        ${name},
        ${link},
        ${JSON.stringify(data)}::jsonb
      )
      ON CONFLICT (svix_id) DO NOTHING
      RETURNING id
    `) as any[];

    if (inserted.length === 0) {
      return res.status(200).json({ duplicate: true, type: eventType });
    }

    // Deliberately NOT updating email_log.status — see the header comment.
    if (resendId) {
      await sql`
        UPDATE email_log
        SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
          last_event: name,
          last_event_at: new Date().toISOString(),
        })}::jsonb
        WHERE resend_id = ${resendId}
      `;
    }

    // Stop mailing the ones that can't or don't want to receive it.
    if (recipient && (name === "bounced" || name === "complained")) {
      // A transient bounce is a full mailbox or a greylist, not a dead address:
      // suppressing on those would throw away reachable customers.
      const bounceType = String(data.bounce?.type ?? "").toLowerCase();

      // A single transient bounce is a full mailbox or a greylist — worth another
      // try. The same address bouncing twice is not: in the first week of real
      // data every repeat bouncer was an abandoned farm inbox whose provider
      // answers "554 service unavailable" forever, which Resend still labels
      // transient. Two strikes and we stop mailing it.
      const priorBounces = (await sql`
        SELECT COUNT(*)::int AS n FROM email_events
        WHERE event = 'bounced' AND lower(recipient) = lower(${recipient}) AND svix_id <> ${svixId}
      `) as any[];
      const repeatBouncer = name === "bounced" && Number(priorBounces[0]?.n ?? 0) >= 1;

      const permanent =
        name === "complained" || bounceType === "permanent" || bounceType === "undetermined" || repeatBouncer;

      if (permanent) {
        const detail =
          name === "complained"
            ? "Recipient marked the email as spam"
            : repeatBouncer && bounceType !== "permanent"
              ? `Bounced ${Number(priorBounces[0]?.n ?? 0) + 1} times (${data.bounce?.subType || "transient"})`
              : data.bounce?.message || data.bounce?.subType || "Hard bounce";
        await sql`
          INSERT INTO email_suppressions (email, reason, detail)
          VALUES (lower(${recipient}), ${name}, ${detail})
          ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, detail = EXCLUDED.detail
        `;
      }

      // A spam complaint is an unsubscribe with feeling: honour it everywhere,
      // not just for campaigns.
      if (name === "complained") {
        await sql`
          INSERT INTO notification_prefs (user_id, email_enabled, updated_at)
          SELECT id, false, now() FROM users WHERE lower(email) = lower(${recipient})
          ON CONFLICT (user_id) DO UPDATE SET email_enabled = false, updated_at = now()
        `;
      }
    }

    console.log(`[resend-webhook] ${eventType} → ${name} for ${recipient ?? resendId}${emailType ? ` (${emailType})` : ""}`);
    return res.status(200).json({ processed: true, event: name, campaign: emailType });
  } catch (err: any) {
    console.error("[resend-webhook] Error:", err?.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

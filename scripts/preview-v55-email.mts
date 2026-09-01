/**
 * Render the v5.5 announcement to a file, and optionally send ONE test copy.
 *
 *   node --env-file=.env --import tsx scripts/preview-v55-email.mts
 *   node --env-file=.env --import tsx scripts/preview-v55-email.mts --send-test
 *
 * --send-test mails exactly one address (the owner). It does NOT start the
 * campaign; that is a separate, deliberate step.
 */
import { writeFileSync } from "fs";
import { buildV55AnnouncementHtml } from "/home/neon/cyberpunk-grok-api/api/_lib/email.ts";
import { getDefaultSubject } from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";
import { unsubUrl } from "/home/neon/cyberpunk-grok-api/api/_lib/notification-prefs.ts";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const sql = getDb();
const [owner] = await sql`
  SELECT id, email FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1`;

const subject = getDefaultSubject("announcement_v55");
const unsub = unsubUrl(owner.id, "*");
const footer = `
    <div style="font-family:'Courier New',monospace;max-width:540px;margin:0 auto;padding:0 32px 28px;text-align:center;">
      <p style="font-size:11px;color:#555;line-height:1.6;margin:0;">
        You're receiving this because you have a verified GLTCH Runner account.<br>
        <a href="${unsub}" style="color:#666;text-decoration:underline;">Unsubscribe from these emails</a>
      </p>
    </div>`;
const html = buildV55AnnouncementHtml() + footer;

const out = "/tmp/gltch-work/v55-email-preview.html";
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${subject}</title><body style="margin:0;background:#0a0a0f">${html}</body>`);
console.log(`subject: ${subject}`);
console.log(`written: ${out}  (${html.length} chars)`);
console.log(`unsubscribe: ${unsub.slice(0, 72)}…`);

if (!process.argv.includes("--send-test")) {
  console.log("\n(pass --send-test to mail one copy to the owner)");
  process.exit(0);
}

const { getResend, getFromAddress } = await import("/home/neon/cyberpunk-grok-api/api/_lib/email.ts");
const resend = getResend();
const { data, error } = await resend.emails.send({
  from: `GLTCHRunner <${getFromAddress()}>`,
  to: [owner.email],
  subject: `[TEST] ${subject}`,
  html,
  headers: {
    "List-Unsubscribe": `<${unsub}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
});
console.log(error ? `\nFAILED: ${error.message}` : `\nsent one test to ${owner.email} (id ${data?.id})`);
process.exit(error ? 1 : 0);

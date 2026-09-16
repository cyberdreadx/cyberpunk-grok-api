/**
 * api/resend-webhook.ts — signature verification, event recording, suppression.
 *
 * The endpoint has never processed a live event (RESEND_WEBHOOK_SECRET was
 * never set), so every path here is unproven code. The signatures below are
 * built the way Svix builds them, so a pass means a real Resend delivery works.
 *
 *   node --env-file=.env --import tsx scripts/test-resend-webhook.mts
 */
process.env.RESEND_API_KEY = "";

import crypto from "crypto";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { getCampaignRecipients } from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";

const SECRET = "whsec_" + crypto.randomBytes(24).toString("base64");
process.env.RESEND_WEBHOOK_SECRET = SECRET;
const handler = (await import("/home/neon/cyberpunk-grok-api/api/resend-webhook.ts")).default;

const sql = getDb();
const P = "webhooktest";
const CAMPAIGN = "zz_test_webhook_campaign";
const EMAIL = `${P}-user@example.test`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

function sign(body: string, id: string, ts: number, secret = SECRET) {
  const bare = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const sig = crypto.createHmac("sha256", Buffer.from(bare, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
}

async function post(event: any, opts: { id?: string; ts?: number; headers?: any; body?: string } = {}) {
  const body = opts.body ?? JSON.stringify(event);
  const id = opts.id ?? `msg_${crypto.randomUUID()}`;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const headers = opts.headers ?? sign(body, id, ts);
  const res: any = {
    code: 0, payload: null,
    status(c: number) { this.code = c; return this; },
    json(o: any) { this.payload = o; return this; },
    end() { return this; },
  };
  await handler({ method: "POST", headers, body } as any, res);
  return res;
}

const evt = (type: string, data: any) => ({ type, data: { email_id: RESEND_ID, to: [EMAIL], ...data } });
const RESEND_ID = crypto.randomUUID();

async function cleanup() {
  await sql`DELETE FROM email_events WHERE recipient = ${EMAIL} OR email_type = ${CAMPAIGN}`;
  await sql`DELETE FROM email_suppressions WHERE email = lower(${EMAIL})`;
  await sql`DELETE FROM email_log WHERE recipient = ${EMAIL} OR email_type = ${CAMPAIGN}`;
  await sql`DELETE FROM notification_prefs WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${P + "-%"})`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "-%"}`;
}

await cleanup();
try {
  await sql`INSERT INTO users (email, password_hash, email_verified) VALUES (${EMAIL}, 'x', true)`;
  await sql`INSERT INTO email_log (recipient, email_type, resend_id, status) VALUES (${EMAIL}, ${CAMPAIGN}, ${RESEND_ID}, 'sent')`;

  console.log("\n── signature ──");
  ok("valid signature accepted", (await post(evt("email.delivered", {}))).code === 200);
  const body = JSON.stringify(evt("email.delivered", {}));
  const id = "msg_tamper", ts = Math.floor(Date.now() / 1000);
  ok("tampered body rejected", (await post(null, { body: body.replace("delivered", "clicked"), headers: sign(body, id, ts), id, ts })).code === 401);
  ok("wrong secret rejected", (await post(null, { body, headers: sign(body, id, ts, "whsec_" + crypto.randomBytes(24).toString("base64")) })).code === 401);
  ok("stale timestamp rejected (replay)", (await post(evt("email.opened", {}), { ts: Math.floor(Date.now() / 1000) - 900 })).code === 401);
  ok("missing headers rejected", (await post(evt("email.opened", {}), { headers: {} })).code === 401);

  console.log("\n── recording ──");
  const clickId = "msg_click_1";
  const click = evt("email.clicked", { click: { link: "https://grokrunner.gltch.app/create?store=1" } });
  ok("click recorded", (await post(click, { id: clickId })).code === 200);
  const [c] = (await sql`SELECT email_type, link, event FROM email_events WHERE event='clicked' AND recipient=${EMAIL}`) as any[];
  ok("click attributed to the campaign", c?.email_type === CAMPAIGN, c?.email_type ?? "none");
  ok("clicked link stored", c?.link?.includes("store=1"), c?.link ?? "none");
  const replay = await post(click, { id: clickId });
  const [{ n: clicks }] = (await sql`SELECT COUNT(*)::int n FROM email_events WHERE event='clicked' AND recipient=${EMAIL}`) as any[];
  ok("retry of the same delivery is not a second click", replay.payload?.duplicate === true && clicks === 1, `clicks=${clicks}`);

  console.log("\n── the dedupe landmine ──");
  const [log] = (await sql`SELECT status, metadata FROM email_log WHERE resend_id=${RESEND_ID}`) as any[];
  ok("email_log.status still 'sent' after events", log?.status === "sent", `status=${log?.status}`);
  ok("last event visible in metadata", !!log?.metadata?.last_event, JSON.stringify(log?.metadata ?? {}));
  const after = await getCampaignRecipients(sql, CAMPAIGN, 50);
  ok("an already-mailed recipient is not re-selected", !after.some((r) => r.email === EMAIL));

  console.log("\n── suppression ──");
  await post(evt("email.bounced", { bounce: { type: "Transient", message: "Mailbox full" } }));
  const [{ n: soft }] = (await sql`SELECT COUNT(*)::int n FROM email_suppressions WHERE email=lower(${EMAIL})`) as any[];
  ok("a transient bounce does NOT suppress", soft === 0);
  await post(evt("email.bounced", { bounce: { type: "Permanent", message: "User unknown" } }));
  const [sup] = (await sql`SELECT reason, detail FROM email_suppressions WHERE email=lower(${EMAIL})`) as any[];
  ok("a hard bounce suppresses the address", sup?.reason === "bounced", sup?.detail ?? "none");

  await sql`DELETE FROM email_log WHERE recipient=${EMAIL} AND email_type=${CAMPAIGN}`;
  const stillOut = await getCampaignRecipients(sql, CAMPAIGN, 50);
  ok("a suppressed address is never selected again", !stillOut.some((r) => r.email === EMAIL));

  await post(evt("email.complained", {}));
  const [comp] = (await sql`SELECT reason FROM email_suppressions WHERE email=lower(${EMAIL})`) as any[];
  const [pref] = (await sql`SELECT p.email_enabled FROM notification_prefs p JOIN users u ON u.id=p.user_id WHERE u.email=${EMAIL}`) as any[];
  ok("a spam complaint suppresses", comp?.reason === "complained");
  ok("a spam complaint also switches email off for that account", pref?.email_enabled === false, JSON.stringify(pref ?? {}));

  console.log("\n── not configured ──");
  delete process.env.RESEND_WEBHOOK_SECRET;
  ok("refuses events when no secret is set", (await post(evt("email.delivered", {}))).code === 503);
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

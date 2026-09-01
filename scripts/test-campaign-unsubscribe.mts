/**
 * Does the campaign unsubscribe actually unsubscribe?
 *
 * An unsubscribe link that appears to work but doesn't is worse than none: the
 * user clicks, keeps getting mail, and reports spam. Tested on a scratch
 * account — never on a real one, because passing means opting that account out.
 *
 * Also checks the thing that made this necessary: campaigns selected every
 * verified user without consulting notification_prefs at all.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { unsubUrl } from "/home/neon/cyberpunk-grok-api/api/_lib/notification-prefs.ts";
import { getCampaignRecipients, getCampaignRemaining } from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";

const sql = getDb();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) { pass++; console.log(`  ok   ${n} ${e}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); }
};

const EMAIL = "unsubtest-v55@example.test";
const cleanup = async () => {
  await sql`DELETE FROM email_log WHERE recipient = ${EMAIL}`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
};
await cleanup();

try {
  const [u] = await sql`
    INSERT INTO users (email, password_hash, email_verified, created_at)
    VALUES (${EMAIL}, 'x', true, now()) RETURNING id`;
  const id = u.id as string;

  const inList = async () =>
    (await getCampaignRecipients(sql, "announcement_v55_probe", 100000))
      .some((r) => r.email === EMAIL);

  console.log("── before unsubscribing ──");
  ok("a verified user is selected for the campaign", await inList());

  console.log("\n── the one-click POST Gmail and Yahoo send ──");
  const url = unsubUrl(id, "*");
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(20000) });
  ok("one-click POST returns 2xx", res.ok, `HTTP ${res.status}`);

  const [prefs] = await sql`
    SELECT email_enabled FROM notification_prefs WHERE user_id = ${id}::uuid`;
  ok("email_enabled is now false", prefs?.email_enabled === false, String(prefs?.email_enabled));

  console.log("\n── after unsubscribing ──");
  ok("the user is NO LONGER selected", !(await inList()),
    "this was the bug — campaigns never joined notification_prefs");

  const remaining = await getCampaignRemaining(sql, "announcement_v55_probe");
  const listed = (await getCampaignRecipients(sql, "announcement_v55_probe", 100000)).length;
  ok("the remaining count agrees with the recipient list", remaining === listed,
    `remaining=${remaining} listed=${listed}`);

  console.log("\n── a bad token changes nothing ──");
  const bad = await fetch(`${url.split("?")[0]}?token=not-a-real-token`, { method: "POST" });
  ok("a forged token is rejected", bad.status === 400, `HTTP ${bad.status}`);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "UNSUBSCRIBE WORKS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

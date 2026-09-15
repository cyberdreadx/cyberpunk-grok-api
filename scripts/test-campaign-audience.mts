/**
 * A campaign with a frozen audience (migration 067) must mail only that audience,
 * and still re-check each member live at send time: verification, opt-out,
 * active bans, a subscription taken out since, and prior delivery.
 *
 *   node --env-file=.env --import tsx scripts/test-campaign-audience.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import {
  getCampaignRecipients,
  getCampaignRemaining,
  hasCampaignAudience,
} from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";

const sql = getDb();
const P = "campaigntest";
const C = "zz_test_audience_campaign";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  if (c) pass++; else fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${e ? `  ${e}` : ""}`);
};

async function mk(tag: string, opts: { verified?: boolean; tier?: string | null } = {}) {
  const [u] = (await sql`
    INSERT INTO users (email, password_hash, email_verified, subscription_tier)
    VALUES (${`${P}-${tag}@example.test`}, 'x', ${opts.verified ?? true}, ${opts.tier ?? null})
    RETURNING id`) as any[];
  return String(u.id);
}

async function cleanup() {
  await sql`DELETE FROM email_log WHERE email_type = ${C}`;
  await sql`DELETE FROM campaign_audience WHERE campaign = ${C}`;
  await sql`DELETE FROM user_bans WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${P + "-%"})`;
  await sql`DELETE FROM notification_prefs WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${P + "-%"})`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "-%"}`;
}

await cleanup();
try {
  const good = await mk("good");
  const optedOut = await mk("optedout");
  const banned = await mk("banned");
  const subscribed = await mk("subscribed", { tier: "basic" });
  const unverified = await mk("unverified", { verified: false });
  const outsider = await mk("outsider");

  await sql`INSERT INTO notification_prefs (user_id, email_enabled) VALUES (${optedOut}::uuid, false)`;
  await sql`INSERT INTO user_bans (user_id, reason) VALUES (${banned}::uuid, 'campaign audience test')`;

  console.log("\n── no audience ──");
  ok("a campaign with no rows is not treated as targeted", !(await hasCampaignAudience(sql, C)));

  console.log("\n── targeted audience ──");
  for (const id of [good, optedOut, banned, subscribed, unverified]) {
    await sql`
      INSERT INTO campaign_audience (campaign, user_id, email, skip_if_subscribed)
      SELECT ${C}, id, email, true FROM users WHERE id = ${id}::uuid`;
  }
  ok("audience detected", await hasCampaignAudience(sql, C));

  const remaining = await getCampaignRemaining(sql, C);
  const recipients = await getCampaignRecipients(sql, C, 50);
  const ids = recipients.map((r) => r.id);
  ok("remaining counts only the eligible member", remaining === 1, `remaining=${remaining}`);
  ok("selects exactly that member", ids.length === 1 && ids[0] === good, JSON.stringify(recipients.map((r) => r.email)));
  ok("skips a member who opted out", !ids.includes(optedOut));
  ok("skips a member with an active ban", !ids.includes(banned));
  ok("skips a member who subscribed since the list was built", !ids.includes(subscribed));
  ok("skips a member who is not verified", !ids.includes(unverified));
  ok("never selects an account outside the audience", !ids.includes(outsider));

  console.log("\n── after delivery ──");
  await sql`INSERT INTO email_log (recipient, email_type, status) VALUES (${`${P}-good@example.test`}, ${C}, 'sent')`;
  ok("remaining drops to 0", (await getCampaignRemaining(sql, C)) === 0);
  ok("nobody is selected again", (await getCampaignRecipients(sql, C, 50)).length === 0);
} finally {
  await cleanup();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

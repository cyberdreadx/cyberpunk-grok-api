/**
 * Build the frozen audience for promo_subscribe_2026_09 (migration 067).
 *
 * The campaign engine used to mail every verified account. The v5.5 blast sent
 * 25,038 emails and 6,078 of them (24.3%) went to throwaway domains, alongside
 * accounts under active bans and farm clusters. Mail to dead and trap inboxes is
 * how a sending domain's reputation drops — and that reputation also carries
 * verification codes and receipts.
 *
 * Kept, one per real inbox: verified, opted in, not subscribed, not actively
 * banned, not on a disposable domain, and not a farm-cluster account (a device
 * fingerprint shared by 6+ live or deleted accounts) — unless that account has
 * actually paid. Fingerprints can collide on identical phones, and a paying
 * customer is not a farmer.
 *
 * One email per canonical inbox (+tags stripped, Gmail dots collapsed), addressed
 * to whichever account on that inbox generated most recently, so the person hears
 * about the account they actually use.
 *
 * Rebuilding replaces the audience, and is refused once any of it has been sent:
 * changing who a half-sent campaign goes to would make its progress meaningless.
 *
 *   node --env-file=.env --import tsx scripts/build-campaign-audience-subscribe.mts          # dry run
 *   node --env-file=.env --import tsx scripts/build-campaign-audience-subscribe.mts --apply
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { isDisposableEmail } from "/home/neon/cyberpunk-grok-api/api/_lib/disposable-domains.ts";
import { canonicalEmail } from "/home/neon/cyberpunk-grok-api/api/_lib/email-canonical.ts";

const CAMPAIGN = "promo_subscribe_2026_09";
const FARM_CLUSTER_MIN = 6;
const APPLY = process.argv.includes("--apply");
const sql = getDb();

const users = (await sql`
  SELECT u.id, u.email, u.subscription_tier, u.subscription_discount_pct, u.device_fingerprint, u.created_at,
         COALESCE(p.email_enabled, true) AS opted_in,
         EXISTS (SELECT 1 FROM user_bans b WHERE b.user_id = u.id
                   AND (b.expires_at IS NULL OR b.expires_at > now())) AS banned
  FROM users u
  LEFT JOIN notification_prefs p ON p.user_id = u.id
  WHERE u.email_verified = true`) as any[];

const lastGen = new Map<string, number>();
for (const r of (await sql`SELECT user_id, MAX(created_at) AS t FROM usage_log GROUP BY user_id`) as any[]) {
  lastGen.set(String(r.user_id), +new Date(r.t));
}
const payers = new Set<string>(
  ((await sql`SELECT DISTINCT user_id FROM transactions`) as any[]).map((r) => String(r.user_id)),
);
const clusters = new Set<string>(
  ((await sql`
    SELECT fp FROM (
      SELECT device_fingerprint AS fp FROM users WHERE COALESCE(device_fingerprint, '') <> ''
      UNION ALL
      SELECT device_fingerprint FROM deleted_accounts WHERE COALESCE(device_fingerprint, '') <> ''
    ) t GROUP BY fp HAVING COUNT(*) >= ${FARM_CLUSTER_MIN}`) as any[]).map((r) => String(r.fp)),
);

const suppressed = new Set<string>(
  ((await sql`SELECT email FROM email_suppressions`) as any[]).map((r) => String(r.email).toLowerCase()),
);

const excluded: Record<string, number> = {
  subscribed: 0, opted_out: 0, banned: 0, disposable: 0, suppressed: 0, farm_cluster: 0, unparseable_email: 0,
};
const bestByInbox = new Map<string, any>();
let eligible = 0;

for (const u of users) {
  const subscribed = String(u.subscription_tier ?? "") !== "" || Number(u.subscription_discount_pct) > 0;
  if (subscribed) { excluded.subscribed++; continue; }
  if (!u.opted_in) { excluded.opted_out++; continue; }
  if (u.banned) { excluded.banned++; continue; }
  if (isDisposableEmail(String(u.email))) { excluded.disposable++; continue; }
  if (suppressed.has(String(u.email).toLowerCase())) { excluded.suppressed++; continue; }
  if (u.device_fingerprint && clusters.has(String(u.device_fingerprint)) && !payers.has(String(u.id))) {
    excluded.farm_cluster++; continue;
  }
  const inbox = canonicalEmail(u.email);
  if (!inbox) { excluded.unparseable_email++; continue; }

  eligible++;
  const score = lastGen.get(String(u.id)) ?? 0;
  const cur = bestByInbox.get(inbox);
  const curScore = cur ? (lastGen.get(String(cur.id)) ?? 0) : -1;
  if (!cur || score > curScore || (score === curScore && +new Date(u.created_at) > +new Date(cur.created_at))) {
    bestByInbox.set(inbox, u);
  }
}

const audience = [...bestByInbox.values()];
console.log(`campaign ${CAMPAIGN}\n`);
console.log(`verified accounts              ${users.length}`);
for (const [k, v] of Object.entries(excluded)) console.log(`  excluded  ${k.padEnd(18)} ${v}`);
console.log(`eligible accounts              ${eligible}`);
console.log(`  duplicate inboxes merged     ${eligible - audience.length}`);
console.log(`AUDIENCE (one per real inbox)  ${audience.length}`);
const active30 = audience.filter((u) => (lastGen.get(String(u.id)) ?? 0) > Date.now() - 30 * 86_400_000).length;
const everPaid = audience.filter((u) => payers.has(String(u.id))).length;
console.log(`  generated in the last 30d    ${active30}`);
console.log(`  have paid before             ${everPaid}`);

const [sent] = (await sql`SELECT COUNT(*)::int AS n FROM email_log WHERE email_type = ${CAMPAIGN} AND status = 'sent'`) as any[];
const [existing] = (await sql`SELECT COUNT(*)::int AS n FROM campaign_audience WHERE campaign = ${CAMPAIGN}`) as any[];
console.log(`\nalready sent for this campaign: ${sent.n} · audience rows now: ${existing.n}`);

if (!APPLY) {
  console.log("\n(dry run — pass --apply to write the audience)");
  process.exit(0);
}
if (sent.n > 0) {
  console.error("\nREFUSED: this campaign has already started sending; its audience is frozen.");
  process.exit(1);
}

await sql`DELETE FROM campaign_audience WHERE campaign = ${CAMPAIGN}`;
const CHUNK = 2000;
let written = 0;
for (let i = 0; i < audience.length; i += CHUNK) {
  const part = audience.slice(i, i + CHUNK);
  const ids = part.map((u) => String(u.id));
  const emails = part.map((u) => String(u.email));
  const rows = (await sql`
    INSERT INTO campaign_audience (campaign, user_id, email, skip_if_subscribed)
    SELECT ${CAMPAIGN}, v.id, v.email, true
    FROM unnest(${ids}::uuid[], ${emails}::text[]) AS v(id, email)
    ON CONFLICT DO NOTHING
    RETURNING user_id`) as any[];
  written += rows.length;
}
const [check] = (await sql`SELECT COUNT(*)::int AS n FROM campaign_audience WHERE campaign = ${CAMPAIGN}`) as any[];
console.log(`\nwrote ${written}; audience rows now ${check.n} ${check.n === audience.length ? "(matches)" : "(MISMATCH)"}`);

/**
 * Pre-send gate for promo_subscribe_2026_09.
 *
 * Every number in the email is checked against the thing it describes — Stripe,
 * checkout.ts, the credit packs, and what users are actually charged — the
 * audience is confirmed, and the exact message one recipient receives is written
 * out for review.
 *
 * Exits 1 on any mismatch, and while MAIL_POSTAL_ADDRESS is unset: a promotional
 * email with no physical postal address breaks CAN-SPAM.
 *
 *   node --env-file=.env --import tsx scripts/check-subscribe-campaign.mts [preview.html]
 */
process.env.RESEND_API_KEY = "";

import { readFileSync, writeFileSync } from "fs";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { DAILY_CREDITS_BY_TIER } from "/home/neon/cyberpunk-grok-api/api/_lib/dailyCredits.ts";
import {
  SUBSCRIBE_PROMO_PLANS,
  SUBSCRIBE_PROMO_BEST_PACK_CENTS,
  SUBSCRIBE_PROMO_IMAGE_CREDITS,
  buildSubscribePromoHtml,
} from "/home/neon/cyberpunk-grok-api/api/_lib/email.ts";
import {
  renderCampaignEmail,
  getCampaignRemaining,
  hasCampaignAudience,
  getDefaultSubject,
} from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";

const CAMPAIGN = "promo_subscribe_2026_09";
const sql = getDb();
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log("── prices match Stripe ──");
for (const p of SUBSCRIBE_PROMO_PLANS) {
  const env = `STRIPE_PRICE_SUB_${p.tier.toUpperCase()}`;
  const id = process.env[env];
  if (!id) { ok(`${p.name}: ${env} is set`, false); continue; }
  const r = await fetch(`https://api.stripe.com/v1/prices/${id}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const d: any = await r.json();
  ok(
    `${p.name} $${p.priceUsd}/mo`,
    d.unit_amount === p.priceUsd * 100 && d.recurring?.interval === "month" && d.active !== false,
    `Stripe: $${(d.unit_amount ?? 0) / 100}/${d.recurring?.interval} active=${d.active}`,
  );
}

console.log("\n── monthly credits match checkout.ts ──");
const checkout = readFileSync("/home/neon/cyberpunk-grok-api/api/checkout.ts", "utf8");
for (const p of SUBSCRIBE_PROMO_PLANS) {
  const m = checkout.match(new RegExp(`^\\s*${p.tier}:\\s*\\{[^}]*creditsPerMonth:\\s*(\\d+)`, "m"));
  ok(`${p.name} ${p.creditsPerMonth}/mo`, !!m && Number(m[1]) === p.creditsPerMonth, `checkout.ts: ${m?.[1] ?? "not found"}`);
}

console.log("\n── the value claim holds ──");
const apiSrc = readFileSync("/home/neon/cyberpunk-grok-api/src/lib/api.ts", "utf8");
const packs = [...apiSrc.matchAll(/credits:\s*(\d+),\s*priceCents:\s*(\d+)/g)].map((m) => ({ credits: +m[1], cents: +m[2] }));
const bestPack = Math.min(...packs.map((x) => x.cents / x.credits));
const basic = SUBSCRIBE_PROMO_PLANS[0];
const basicRate = (basic.priceUsd * 100) / basic.creditsPerMonth;
ok(`${packs.length} credit packs read from src/lib/api.ts`, packs.length >= 3);
ok(`best pack is ${SUBSCRIBE_PROMO_BEST_PACK_CENTS}¢ a credit`, Math.round(bestPack * 10) / 10 === SUBSCRIBE_PROMO_BEST_PACK_CENTS, `actual ${bestPack.toFixed(3)}¢`);
ok(`Basic at ${basicRate.toFixed(2)}¢ beats every pack`, basicRate < bestPack);

console.log("\n── image cost matches what users are charged (last 7 days) ──");
const costs = (await sql`
  SELECT mode, mode() WITHIN GROUP (ORDER BY credits_used) AS usual, COUNT(*)::int AS n
  FROM usage_log
  WHERE mode IN ('comfy-klein', 'comfy-krea2', 'comfy-zimage') AND credits_used > 0
    AND created_at > now() - interval '7 days'
  GROUP BY mode ORDER BY mode`) as any[];
ok("image engines have recent charges to compare", costs.length > 0);
for (const c of costs) {
  ok(`${c.mode} usually costs ${SUBSCRIBE_PROMO_IMAGE_CREDITS}`, Number(c.usual) === SUBSCRIBE_PROMO_IMAGE_CREDITS, `most common charge ${c.usual} over ${c.n} jobs`);
}

console.log("\n── rendered email ──");
const html = buildSubscribePromoHtml();
for (const [tier, n] of Object.entries(DAILY_CREDITS_BY_TIER)) ok(`shows ${tier} +${n}/day from the daily table`, html.includes(`+${n}/day`));
for (const bad of [/10 free/i, /\bNSFW\b/i, /GLTCH PRO/i, /\bunlimited\b/i]) ok(`makes no claim matching ${bad}`, !bad.test(html));
ok("button opens the store", html.includes("/create?store=1"));
const subject = getDefaultSubject(CAMPAIGN);
ok(`subject registered`, subject.includes("$9"), subject);

console.log("\n── compliance ──");
const postal = (process.env.MAIL_POSTAL_ADDRESS || "").trim();
ok("MAIL_POSTAL_ADDRESS is set (CAN-SPAM requires a physical postal address)", postal.length > 0, postal || "unset");
const full = renderCampaignEmail({ campaign: CAMPAIGN, html: null }, "00000000-0000-0000-0000-000000000000");
ok("visible unsubscribe link", /Unsubscribe from these emails/.test(full));
if (postal) ok("postal address appears in the footer", full.includes(postal.split(",")[0].replace(/&/g, "&amp;")));

console.log("\n── audience ──");
const targeted = await hasCampaignAudience(sql, CAMPAIGN);
ok("targeted audience built", targeted);
const [{ n: audience }] = (await sql`SELECT COUNT(*)::int AS n FROM campaign_audience WHERE campaign = ${CAMPAIGN}`) as any[];
const [{ n: sent }] = (await sql`SELECT COUNT(*)::int AS n FROM email_log WHERE email_type = ${CAMPAIGN} AND status = 'sent'`) as any[];
const [{ n: verified }] = (await sql`SELECT COUNT(*)::int AS n FROM users WHERE email_verified = true`) as any[];
const remaining = targeted ? await getCampaignRemaining(sql, CAMPAIGN) : 0;
console.log(`  audience ${audience} · would send now ${remaining} · already sent ${sent} · all verified ${verified}`);
ok("sends to a filtered subset, not every verified account", targeted && remaining > 0 && remaining < verified);

const out = process.argv[2] || "/tmp/claude-1002/-home-neon/5b6b055f-35b3-4494-b505-802f304e4072/scratchpad/subscribe-promo-preview.html";
writeFileSync(out, full);
console.log(`\nexactly what one recipient receives: ${out}`);
console.log(`\n${fail === 0 ? "READY TO SEND" : `NOT READY — ${fail} check(s) failed`}`);
process.exit(fail ? 1 : 0);

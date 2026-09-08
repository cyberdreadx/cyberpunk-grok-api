/**
 * Active Stripe subscriptions with no user behind them.
 *
 * api/auth/delete-account.ts tries to cancel a leaver's subscription, but the
 * live key is restricted and has no Subscriptions Write scope, so the call
 * throws every time. The catch logs a warning and the comment says "Continue
 * with deletion anyway" — so the user row is dropped and the subscription bills
 * on, forever, against a card belonging to someone with no account.
 *
 * It surfaced as a webhook 500: invoice.paid arrived for a user_id that no
 * longer existed, hit a foreign key, and because the event had already been
 * marked processed, Stripe's retry was discarded as a duplicate.
 *
 * This lists everyone currently in that position and what they have been
 * charged. Read-only — it cancels nothing and refunds nothing, because the key
 * could not do either even if it were asked to.
 *
 *   node --env-file=.env --import tsx scripts/orphaned-subs.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const KEY = process.env.STRIPE_SECRET_KEY!;
const sql = getDb();

async function stripeGet(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  return r.json() as any;
}

// Every active/past_due subscription, paged.
const subs: any[] = [];
let starting_after: string | undefined;
for (let page = 0; page < 40; page++) {
  const p: Record<string, string> = { limit: "100", "expand[]": "data.customer" };
  if (starting_after) p.starting_after = starting_after;
  const d = await stripeGet("subscriptions", { ...p, status: "active" });
  if (d.error) { console.error("stripe:", d.error.message); break; }
  subs.push(...d.data);
  if (!d.has_more) break;
  starting_after = d.data[d.data.length - 1].id;
}
console.log(`active subscriptions in Stripe: ${subs.length}`);

// Which of those customers do we still have a user row for?
const custIds = subs.map((s) => (typeof s.customer === "string" ? s.customer : s.customer?.id)).filter(Boolean);
const known = new Set(
  ((await sql`
    SELECT stripe_customer_id FROM users
    WHERE stripe_customer_id = ANY(${custIds})`) as any[]).map((r: any) => r.stripe_customer_id),
);

const orphans = subs.filter((s) => {
  const cid = typeof s.customer === "string" ? s.customer : s.customer?.id;
  return cid && !known.has(cid);
});

console.log(`matched to a live user      : ${subs.length - orphans.length}`);
console.log(`ORPHANED (no user row)      : ${orphans.length}\n`);

if (!orphans.length) process.exit(0);

let monthly = 0, lifetime = 0;
console.log("customer               email                          $/mo   paid    since");
for (const s of orphans) {
  const c = s.customer;
  const amt = (s.items?.data?.[0]?.price?.unit_amount || 0) / 100;
  monthly += amt;

  const inv = await stripeGet("invoices", { customer: c.id, limit: "100" });
  const paid = (inv.data || []).filter((i: any) => i.amount_paid > 0);
  const total = paid.reduce((a: number, i: any) => a + i.amount_paid, 0) / 100;
  lifetime += total;
  const since = paid.length ? new Date(paid[paid.length - 1].created * 1000).toISOString().slice(0, 10) : "—";

  console.log(
    `${c.id.padEnd(22)} ${String(c.email ?? "—").padEnd(30)} ${amt.toFixed(2).padStart(6)} ` +
    `${("$" + total.toFixed(2)).padStart(8)}  ${since}  (${paid.length} invoices)`,
  );
}

console.log(`\nstill billing : $${monthly.toFixed(2)}/month across ${orphans.length} people`);
console.log(`already taken : $${lifetime.toFixed(2)} lifetime from these customers`);
console.log("\nNothing here can be cancelled with the current key — it lacks Subscriptions Write.");

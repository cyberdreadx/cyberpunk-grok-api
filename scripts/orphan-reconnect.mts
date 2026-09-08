/**
 * Can the orphaned subscribers be reconnected to a live account?
 *
 * 11 people are paying for accounts that no longer exist. Two ways out of that:
 * stop charging them, or give them back what they are paying for. This checks
 * which is possible per person, by matching the Stripe customer email against
 * live users.
 *
 * A match means they are still here and still want the product — they are
 * paying, they just cannot reach it. Relinking turns an unbillable charge into
 * a delivered subscription. No match means there is nobody to deliver to and
 * the only honest option is to cancel.
 *
 * Read-only by default. --apply relinks the matched ones: points
 * users.stripe_customer_id at the customer that is actually being billed and
 * restores the tier they are paying for.
 *
 *   node --env-file=.env --import tsx scripts/orphan-reconnect.mts [--apply]
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const APPLY = process.argv.includes("--apply");
const KEY = process.env.STRIPE_SECRET_KEY!;
const sql = getDb();

async function sget(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  return r.json() as any;
}

// Re-derive the orphan list rather than trusting a pasted one.
const subs: any[] = [];
let after: string | undefined;
for (let i = 0; i < 40; i++) {
  const p: Record<string, string> = { limit: "100", status: "active", "expand[]": "data.customer" };
  if (after) p.starting_after = after;
  const d = await sget("subscriptions", p);
  if (d.error) { console.error("stripe:", d.error.message); process.exit(1); }
  subs.push(...d.data);
  if (!d.has_more) break;
  after = d.data[d.data.length - 1].id;
}

const cids = subs.map((s) => (typeof s.customer === "string" ? s.customer : s.customer?.id)).filter(Boolean);
const known = new Set(((await sql`
  SELECT stripe_customer_id FROM users WHERE stripe_customer_id = ANY(${cids})`) as any[])
  .map((r: any) => r.stripe_customer_id));

const orphans = subs
  .filter((s) => !known.has(typeof s.customer === "string" ? s.customer : s.customer?.id))
  // Oldest first, so when one person holds several the one kept is the one
  // they have been paying longest.
  .sort((a, b) => a.created - b.created);

/** Stripe price → the tier the app understands. */
function tierFor(cents: number): string | null {
  if (cents >= 2499) return "premium";
  if (cents >= 999) return "basic";
  if (cents >= 900) return "basic";
  return null;
}

console.log(`orphaned active subscriptions: ${orphans.length}\n`);
console.log("email                          $/mo  live account?          action");

let reconnectable = 0, monthlyRecoverable = 0;
const plan: Array<{ userId: string; cus: string; tier: string; email: string; amt: number }> = [];

for (const s of orphans) {
  const c = s.customer;
  const cents = s.items?.data?.[0]?.price?.unit_amount || 0;
  const amt = cents / 100;
  const email = c.email as string | null;

  const [u] = email
    ? ((await sql`SELECT id, subscription_tier, stripe_customer_id FROM users
        WHERE lower(email) = lower(${email}) LIMIT 1`) as any[])
    : [];

  const tier = tierFor(cents);
  let action: string;
  // One account can only hold one subscription. Three of these are the same
  // person who resubscribed each time the last one stopped working, so
  // relinking all of them would just triple-charge one user with extra steps.
  // Keep the oldest — it is the one they have been paying longest — and the
  // rest are duplicates that cannot be delivered against.
  const already = u && plan.some((p) => p.userId === u.id);
  if (u && tier && !already) {
    reconnectable++; monthlyRecoverable += amt;
    action = `RELINK → ${tier}`;
    plan.push({ userId: u.id, cus: c.id, tier, email: email!, amt });
  } else if (u && tier && already) {
    action = "DUPLICATE of the same user — cancel, cannot be delivered";
  } else if (u) {
    action = "live account, price maps to no tier — needs a look";
  } else {
    action = "no account — cancel is the only honest option";
  }

  console.log(
    `${String(email ?? "—").padEnd(30)} ${amt.toFixed(2).padStart(6)}  ${(u ? "yes" : "no").padEnd(22)} ${action}`,
  );
}

console.log(`\nreconnectable      : ${reconnectable} of ${orphans.length}`);
console.log(`revenue made real  : $${monthlyRecoverable.toFixed(2)}/month`);
console.log(`must be cancelled  : $${(orphans.reduce((a, s) => a + (s.items?.data?.[0]?.price?.unit_amount || 0) / 100, 0) - monthlyRecoverable).toFixed(2)}/month`);

if (!APPLY) { console.log("\n(dry run — pass --apply to relink the matched accounts)"); process.exit(0); }

for (const p of plan) {
  await sql`
    UPDATE users
    SET stripe_customer_id = ${p.cus}, subscription_tier = ${p.tier}, updated_at = now()
    WHERE id = ${p.userId}::uuid`;
  console.log(`relinked ${p.email} → ${p.cus} (${p.tier})`);
}
console.log(`\n${plan.length} accounts relinked. They can now reach the billing portal, and the`);
console.log(`next invoice.paid will grant credits instead of hitting a foreign key.`);

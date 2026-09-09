/**
 * GLTCH subscriptions still billing accounts that no longer exist.
 *
 * api/auth/delete-account.ts used to call stripe.subscriptions.cancel(), catch
 * the failure, and delete the user row anyway. The live key is restricted with
 * no Subscriptions Write scope, so that call threw every time — the row went,
 * the subscription billed on, and every later invoice 500'd on the foreign key
 * from transactions.user_id. Fixed 2026-09-08; this reports the wreckage left
 * behind.
 *
 * THIS STRIPE ACCOUNT CARRIES MORE THAN ONE BUSINESS. An earlier version of
 * this script flagged every active subscription whose customer had no GLTCH
 * user row, which swept in a $266.25/month website-maintenance contract from an
 * unrelated service and overstated the problem by more than half. A customer
 * having no row in *our* users table means nothing on its own — that is the
 * normal state for another product's customers.
 *
 * So classification is by product, and it is deliberately three-way. Anything
 * it cannot place lands in NEEDS A LOOK rather than being guessed into one pile
 * or the other: a false positive here means cancelling a stranger's paid
 * service, and a false negative means someone keeps getting charged.
 *
 *   node --env-file=.env --import tsx scripts/orphaned-subs.mts
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";

const KEY = process.env.STRIPE_SECRET_KEY!;
const sql = getDb();

/**
 * Products that are definitely NOT GLTCH. Add to this as other businesses
 * appear on the account; an entry here is a promise that the product is
 * someone else's, so keep it specific.
 */
const NOT_GLTCH = [/website\s*maintenance/i, /\bhosting\b/i, /\bconsult/i, /\bretainer\b/i];

/**
 * Positive GLTCH signals beyond the configured price ladder. GLTCH sells
 * credits, and it sells creator verification; nothing else on the account does.
 * Retired ladders ("Premium Monthly (500 Credits/mo)") no longer match any env
 * var but are still very much ours — the legacy tier kaoskaido's own
 * transaction row calls `subscription/legacy 500cr`.
 */
const IS_GLTCH = [/credits?/i, /\bverif/i];

async function sget(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  return r.json() as any;
}
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

// The current ladder, straight from config — the most reliable signal there is.
const ladder = new Map<string, string>();
for (const e of [
  "STRIPE_PRICE_SUB_BASIC", "STRIPE_PRICE_SUB_PREMIUM", "STRIPE_PRICE_SUB_PRO", "STRIPE_PRICE_SUB_ELITE",
  "STRIPE_PRICE_SUB_BASIC_YEARLY", "STRIPE_PRICE_SUB_PREMIUM_YEARLY",
  "STRIPE_PRICE_SUB_PRO_YEARLY", "STRIPE_PRICE_SUB_ELITE_YEARLY",
]) {
  const v = process.env[e];
  if (v) ladder.set(v, e.replace("STRIPE_PRICE_SUB_", "").toLowerCase());
}

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

const cids = subs.map((s) => s.customer?.id).filter(Boolean);
const known = new Set(((await sql`
  SELECT stripe_customer_id FROM users WHERE stripe_customer_id = ANY(${cids})`) as any[])
  .map((r: any) => r.stripe_customer_id));

const productName = new Map<string, string>();
async function nameOf(id: string): Promise<string> {
  if (!productName.has(id)) productName.set(id, (await sget(`products/${id}`))?.name ?? id);
  return productName.get(id)!;
}

type Verdict = "gltch" | "other" | "unknown";
function classify(priceId: string, name: string): Verdict {
  if (ladder.has(priceId)) return "gltch";
  if (NOT_GLTCH.some((re) => re.test(name))) return "other";
  if (IS_GLTCH.some((re) => re.test(name))) return "gltch";
  return "unknown";
}

const buckets: Record<Verdict, any[]> = { gltch: [], other: [], unknown: [] };
for (const s of subs) {
  if (known.has(s.customer?.id)) continue; // has a live GLTCH account — not orphaned
  const item = s.items?.data?.[0];
  const name = await nameOf(String(item?.price?.product));
  buckets[classify(item?.price?.id, name)].push({
    sub: s.id,
    email: s.customer?.email ?? "—",
    amount: (item?.price?.unit_amount || 0) / 100,
    next: s.current_period_end,
    product: name,
  });
}

function show(title: string, rows: any[], note: string) {
  console.log(`\n── ${title} (${rows.length}) ──`);
  if (!rows.length) { console.log("  none"); return; }
  console.log(`  ${note}\n`);
  console.log("  next charge   $/mo   product                            subscription id");
  let t = 0;
  for (const r of rows.sort((a, b) => a.next - b.next)) {
    t += r.amount;
    console.log(
      `  ${day(r.next)}   ${r.amount.toFixed(2).padStart(6)}  ${String(r.product).slice(0, 33).padEnd(35)} ${r.sub}`,
    );
    console.log(`  ${" ".repeat(12)}${r.email}`);
  }
  console.log(`\n  total: $${t.toFixed(2)}/month`);
}

show("GLTCH — billing accounts that no longer exist", buckets.gltch,
  "Cancel these. Dashboard -> Billing -> Subscriptions -> paste the id ->\n  Actions -> Cancel. Choose 'immediately'; 'at period end' bills once more.");

show("NOT GLTCH — another business on this Stripe account", buckets.other,
  "Leave these alone. They have no GLTCH user row because they were never\n  GLTCH customers.");

show("NEEDS A LOOK — could not classify", buckets.unknown,
  "Not guessed either way on purpose. Add the product to NOT_GLTCH or\n  IS_GLTCH at the top of this file once you know which it is.");

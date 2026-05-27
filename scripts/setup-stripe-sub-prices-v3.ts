/**
 * scripts/setup-stripe-sub-prices-v3.ts
 *
 * Creates the 8 repriced subscription Stripe prices matching src/lib/api.ts:
 *   CASUAL $9 · REGULAR $19 · HOBBYIST $39 · POWER USER $79
 *   Yearly = monthly × 12 × 0.88 (12% savings)
 *
 * Credit packs are unchanged — only subscription tiers need new price IDs.
 *
 * USAGE (test mode key):
 *   STRIPE_SECRET_KEY=sk_test_... bunx tsx scripts/setup-stripe-sub-prices-v3.ts
 *
 * USAGE (live — pass --live or use sk_live_ key):
 *   STRIPE_SECRET_KEY=sk_live_... bunx tsx scripts/setup-stripe-sub-prices-v3.ts --live
 *
 * Paste the printed env block into Vercel, then preview/swap at /admin/stripe-prices
 * before redeploying. Existing subscribers stay on their old price until they change plans.
 */

import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("ERROR: Set STRIPE_SECRET_KEY (or STRIPE_API_KEY) to your Stripe secret key.");
  process.exit(1);
}

const forceLive = process.argv.includes("--live");
const isLiveKey = STRIPE_SECRET_KEY.startsWith("sk_live_") || STRIPE_SECRET_KEY.startsWith("rk_live_");
if (forceLive && !isLiveKey) {
  console.error("ERROR: --live passed but key is not sk_live_... or rk_live_...");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

/** Must stay in sync with SUBSCRIPTION_TIERS_* in src/lib/api.ts */
const SUB_PRICES: Array<{
  envKey: string;
  tier: string;
  displayName: string;
  amountCents: number;
  interval: "month" | "year";
  discountPct: number;
}> = [
  { envKey: "STRIPE_PRICE_SUB_BASIC", tier: "basic", displayName: "Casual", amountCents: 900, interval: "month", discountPct: 15 },
  { envKey: "STRIPE_PRICE_SUB_PREMIUM", tier: "premium", displayName: "Regular", amountCents: 1900, interval: "month", discountPct: 30 },
  { envKey: "STRIPE_PRICE_SUB_PRO", tier: "pro", displayName: "Hobbyist", amountCents: 3900, interval: "month", discountPct: 50 },
  { envKey: "STRIPE_PRICE_SUB_ELITE", tier: "elite", displayName: "Power User", amountCents: 7900, interval: "month", discountPct: 70 },
  { envKey: "STRIPE_PRICE_SUB_BASIC_YEARLY", tier: "basic-yearly", displayName: "Casual", amountCents: 9504, interval: "year", discountPct: 15 },
  { envKey: "STRIPE_PRICE_SUB_PREMIUM_YEARLY", tier: "premium-yearly", displayName: "Regular", amountCents: 20064, interval: "year", discountPct: 30 },
  { envKey: "STRIPE_PRICE_SUB_PRO_YEARLY", tier: "pro-yearly", displayName: "Hobbyist", amountCents: 41184, interval: "year", discountPct: 50 },
  { envKey: "STRIPE_PRICE_SUB_ELITE_YEARLY", tier: "elite-yearly", displayName: "Power User", amountCents: 83424, interval: "year", discountPct: 70 },
];

function productLabel(p: (typeof SUB_PRICES)[number]) {
  const yearly = p.interval === "year" ? " Yearly" : " Monthly";
  return `${p.displayName}${yearly} (${p.discountPct}% OFF)`;
}

async function createPrice(spec: (typeof SUB_PRICES)[number]): Promise<string> {
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: spec.amountCents,
    recurring: { interval: spec.interval },
    product_data: {
      name: productLabel(spec),
      metadata: {
        type: "subscription",
        tier: spec.tier,
        discount_pct: String(spec.discountPct),
        credits_per_month: "0",
        pricing_version: "v3",
      },
    },
  });
  return price.id;
}

async function main() {
  const mode = isLiveKey ? "LIVE" : "TEST";
  console.log(`=== Stripe subscription prices v3 (${mode}) ===\n`);

  const results: Record<string, string> = {};

  for (const spec of SUB_PRICES) {
    process.stdout.write(`Creating ${spec.envKey} ($${(spec.amountCents / 100).toFixed(2)}/${spec.interval})… `);
    try {
      const id = await createPrice(spec);
      results[spec.envKey] = id;
      console.log(id);
    } catch (err: any) {
      console.log("FAILED");
      console.error(err.message || err);
      process.exit(1);
    }
  }

  console.log(`
============================================
Paste these into Vercel env (Production):

${Object.entries(results).map(([k, v]) => `${k}=${v}`).join("\n")}
============================================

Next steps:
  1. Open /admin/stripe-prices and paste the new price_ IDs into the draft column.
  2. Click "preview draft" — confirm amounts match CASUAL/REGULAR/HOBBYIST/POWER USER.
  3. Run "test ↗" on one monthly + one yearly tier.
  4. Update Vercel env vars and redeploy.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

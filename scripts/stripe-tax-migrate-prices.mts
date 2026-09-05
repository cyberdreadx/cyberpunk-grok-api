/**
 * Clone the 14 tax-blind Prices into tax_behavior="exclusive" replacements.
 *
 * tax_behavior cannot be changed on a Price after creation, so enabling VAT
 * means new Price objects and repointing the env vars at them. Same product,
 * same amount, same interval — only the tax flag differs, so nothing the
 * customer sees changes except VAT appearing at checkout.
 *
 *   node --env-file=.env --import tsx scripts/stripe-tax-migrate-prices.mts
 *   node --env-file=.env --import tsx scripts/stripe-tax-migrate-prices.mts --write
 *
 * Dry run by default. --write creates the Prices and prints the .env lines to
 * paste; it deliberately does NOT edit .env or archive the old Prices, because
 * existing subscribers keep billing on the old ids and archiving them under
 * live subscriptions is not something a script should decide.
 */
process.env.RESEND_API_KEY = "";

import Stripe from "/home/neon/cyberpunk-grok-api/node_modules/stripe/esm/stripe.esm.node.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" as any });
const WRITE = process.argv.includes("--write");
const TAX_CODE = "txcd_10000000"; // electronically supplied services

const keys = Object.keys(process.env)
  .filter((k) => /^STRIPE_.*PRICE/.test(k) && String(process.env[k] || "").startsWith("price_"))
  .sort();

const envLines: string[] = [];
let need = 0, made = 0;

for (const key of keys) {
  const id = String(process.env[key]);
  let p: any;
  try {
    p = await stripe.prices.retrieve(id, { expand: ["product"] });
  } catch (e: any) {
    console.log(`SKIP  ${key} — ${String(e.message).slice(0, 60)}`);
    continue;
  }

  if (p.tax_behavior && p.tax_behavior !== "unspecified") {
    console.log(`OK    ${key.padEnd(32)} already ${p.tax_behavior}`);
    continue;
  }
  need++;

  const amount = p.unit_amount;
  const interval = p.recurring?.interval;
  const desc = `${(amount / 100).toFixed(2)} ${String(p.currency).toUpperCase()}${interval ? `/${interval}` : " one-time"}`;
  console.log(`NEEDS ${key.padEnd(32)} ${desc}`);

  if (!WRITE) continue;

  try {
    // Product tax_code is set on the product, not the price, and is what
    // decides which VAT rate applies in each country.
    const productId = typeof p.product === "string" ? p.product : p.product.id;
    await stripe.products.update(productId, { tax_code: TAX_CODE }).catch((e: any) =>
      console.log(`      (could not set product tax_code: ${String(e.message).slice(0, 50)})`),
    );

    const created: any = await stripe.prices.create({
      product: productId,
      currency: p.currency,
      unit_amount: amount,
      tax_behavior: "exclusive",
      ...(interval ? { recurring: { interval, interval_count: p.recurring.interval_count } } : {}),
      metadata: { replaces: id, reason: "tax_behavior exclusive for EU/UK VAT" },
    });
    console.log(`      → ${created.id}`);
    envLines.push(`${key}="${created.id}"`);
    made++;
  } catch (e: any) {
    console.log(`      FAILED: ${String(e.message).slice(0, 100)}`);
  }
}

console.log(`\n${"─".repeat(60)}`);
if (!WRITE) {
  console.log(`${need} price(s) need replacing. Re-run with --write to create them.`);
  process.exit(0);
}

console.log(`created ${made} of ${need}\n`);
if (envLines.length) {
  console.log(`paste into .env, replacing the matching lines:\n`);
  for (const l of envLines) console.log(`  ${l}`);
  console.log(`
then:
  sudo systemctl restart grokrunner
  node --env-file=.env --import tsx scripts/stripe-tax-preflight.mts

Old prices are left active on purpose — existing subscribers still bill on
them. Archive them only once nobody is on them.`);
}
process.exit(0);

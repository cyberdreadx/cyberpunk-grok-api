/**
 * Is it safe to set STRIPE_TAX_ENABLED=true?
 *
 * Stripe rejects a checkout session outright when automatic_tax is on and a
 * Price has no tax_behavior. Flipping the switch before the dashboard side is
 * done therefore does not degrade gracefully — it takes down every purchase on
 * the site. So this checks first.
 *
 *   node --env-file=.env --import tsx scripts/stripe-tax-preflight.mts
 *
 * Read-only. Touches Stripe, changes nothing.
 */
process.env.RESEND_API_KEY = "";

import Stripe from "/home/neon/cyberpunk-grok-api/node_modules/stripe/esm/stripe.esm.node.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" as any });

let blockers = 0;
const bad = (s: string) => { console.log(`  BLOCKED  ${s}`); blockers++; };
const ok = (s: string) => console.log(`  OK       ${s}`);

console.log(`STRIPE_TAX_ENABLED is currently: ${process.env.STRIPE_TAX_ENABLED || "(unset — tax off)"}\n`);

// ── 1. Is Stripe Tax actually switched on for the account? ────────────────
console.log("account:");
try {
  const settings: any = await (stripe as any).tax.settings.retrieve();
  if (settings?.status === "active") ok(`Stripe Tax active · default code ${settings.defaults?.tax_code || "(none)"}`);
  else bad(`Stripe Tax status is "${settings?.status}" — activate it in Dashboard → Tax`);
  if (!settings?.defaults?.tax_behavior) {
    bad(`no default tax_behavior — set it to "exclusive" so tax is added on top`);
  } else {
    ok(`default tax_behavior: ${settings.defaults.tax_behavior}`);
  }
  const origin = settings?.head_office?.address?.country;
  origin ? ok(`origin address set (${origin})`) : bad("no head office address — Tax cannot source from nowhere");
} catch (e: any) {
  bad(`could not read tax settings: ${String(e.message).slice(0, 90)}`);
  console.log(`           (a restricted key may lack tax scope — check the dashboard by hand)`);
}

// ── 2. Every price the app actually charges must carry tax_behavior ───────
console.log("\nprices referenced by the app:");
const priceKeys = Object.keys(process.env).filter(
  (k) => /^STRIPE_.*PRICE/.test(k) && String(process.env[k] || "").startsWith("price_"),
);
if (!priceKeys.length) console.log("  (no STRIPE_*PRICE* env vars found)");

for (const key of priceKeys) {
  const id = String(process.env[key]);
  try {
    const p: any = await stripe.prices.retrieve(id, { expand: ["product"] });
    const behavior = p.tax_behavior;
    const code = p.product?.tax_code;
    if (!behavior || behavior === "unspecified") {
      bad(`${key.padEnd(34)} tax_behavior=${behavior || "null"} — set it on this price`);
    } else {
      ok(`${key.padEnd(34)} ${behavior}${code ? ` · ${typeof code === "string" ? code : code.id}` : " · no product tax_code"}`);
    }
  } catch (e: any) {
    bad(`${key.padEnd(34)} ${String(e.message).slice(0, 60)}`);
  }
}

console.log(`\n${"─".repeat(64)}`);
if (blockers === 0) {
  console.log(`clear. set STRIPE_TAX_ENABLED=true in .env and restart grokrunner.`);
  console.log(`then buy something from an EU IP and confirm VAT appears on the session.`);
} else {
  console.log(`${blockers} blocker(s). DO NOT enable — checkout will fail for everyone.`);
  console.log(`
tax_behavior cannot be changed on a Price after creation. For each blocked
price: create a replacement with tax_behavior "exclusive" in Dashboard →
Products, then point the matching STRIPE_*PRICE* env var at the new id.`);
}
process.exit(blockers ? 1 : 0);

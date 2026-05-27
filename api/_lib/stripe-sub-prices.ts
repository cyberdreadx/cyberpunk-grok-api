/**
 * Stripe subscription price helpers — shared by webhook + admin reconcile.
 *
 * v3 subs (STRIPE_PRICE_SUB_* env) = discount-only, 0 monthly credits.
 * Any other active sub price ID = legacy; grant credits on invoice.paid.
 */

export const TIER_DISCOUNT_PCT: Record<string, number> = {
  basic: 15,
  "basic-yearly": 15,
  premium: 30,
  "premium-yearly": 30,
  pro: 50,
  "pro-yearly": 50,
  elite: 70,
  "elite-yearly": 70,
};

const SUB_PRICE_ENV_KEYS = [
  "STRIPE_PRICE_SUB_BASIC",
  "STRIPE_PRICE_SUB_PREMIUM",
  "STRIPE_PRICE_SUB_PRO",
  "STRIPE_PRICE_SUB_ELITE",
  "STRIPE_PRICE_SUB_BASIC_YEARLY",
  "STRIPE_PRICE_SUB_PREMIUM_YEARLY",
  "STRIPE_PRICE_SUB_PRO_YEARLY",
  "STRIPE_PRICE_SUB_ELITE_YEARLY",
] as const;

/** Current v3 price IDs only — used to detect legacy grandfathered subs. */
export function getCurrentSubPriceIds(): Set<string> {
  const ids = new Set<string>();
  for (const key of SUB_PRICE_ENV_KEYS) {
    const id = process.env[key];
    if (id) ids.add(id);
  }
  return ids;
}

let _priceIdTierMap: Record<string, string> | null = null;

/** Price ID → tier (current env + optional STRIPE_LEGACY_PRICE_MAP for tier/discount). */
export function getPriceIdTierMap(): Record<string, string> {
  if (_priceIdTierMap) return _priceIdTierMap;
  const map: Record<string, string> = {};
  const envKeys: Record<string, string> = {
    STRIPE_PRICE_SUB_BASIC: "basic",
    STRIPE_PRICE_SUB_PREMIUM: "premium",
    STRIPE_PRICE_SUB_PRO: "pro",
    STRIPE_PRICE_SUB_ELITE: "elite",
    STRIPE_PRICE_SUB_BASIC_YEARLY: "basic-yearly",
    STRIPE_PRICE_SUB_PREMIUM_YEARLY: "premium-yearly",
    STRIPE_PRICE_SUB_PRO_YEARLY: "pro-yearly",
    STRIPE_PRICE_SUB_ELITE_YEARLY: "elite-yearly",
  };
  for (const [envKey, tier] of Object.entries(envKeys)) {
    const id = process.env[envKey];
    if (id) map[id] = tier;
  }
  try {
    const raw = process.env.STRIPE_LEGACY_PRICE_MAP;
    if (raw) {
      const legacy = JSON.parse(raw) as Record<string, string>;
      for (const [pid, tier] of Object.entries(legacy)) {
        if (TIER_DISCOUNT_PCT[tier] != null) map[pid] = tier;
      }
    }
  } catch {
    // caller may log
  }
  _priceIdTierMap = map;
  return map;
}

/** Collect price IDs from an invoice line + subscription items. */
export function extractSubPriceIds(invoice: any, subscription: { items?: { data?: any[] } } | null): string[] {
  const ids: string[] = [];
  const push = (pid: unknown) => {
    if (typeof pid === "string" && pid.startsWith("price_") && !ids.includes(pid)) ids.push(pid);
  };

  for (const line of invoice?.lines?.data || []) {
    push(line?.price?.id);
    push(line?.pricing?.price_details?.price);
    push(line?.plan?.id);
  }

  for (const item of subscription?.items?.data || []) {
    push(item?.price?.id);
    push(item?.plan?.id);
  }

  return ids;
}

/** Legacy = billed on a price ID that is NOT one of the current v3 STRIPE_PRICE_SUB_* values. */
export function isLegacySubPrice(priceIds: string[]): boolean {
  if (priceIds.length === 0) return false;
  const current = getCurrentSubPriceIds();
  return !priceIds.some((pid) => current.has(pid));
}

function parseLegacyCreditOverrides(): Record<string, number> {
  try {
    const raw = process.env.STRIPE_LEGACY_PRICE_CREDITS;
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * Credits to grant on invoice.paid for a legacy-price subscription.
 * Priority: per-price override → subscription metadata credits_per_month → ~13 credits/$.
 */
export function computeLegacyCreditGrant(opts: {
  priceIds: string[];
  amountPaidCents: number;
  creditsPerMonthMeta?: number;
}): number {
  const { priceIds, amountPaidCents, creditsPerMonthMeta } = opts;
  if (amountPaidCents <= 0) return 0;

  const overrides = parseLegacyCreditOverrides();
  for (const pid of priceIds) {
    if (overrides[pid] != null && overrides[pid] > 0) return overrides[pid];
  }

  if (creditsPerMonthMeta != null && creditsPerMonthMeta > 0) {
    return creditsPerMonthMeta;
  }

  const perDollar = Number(process.env.LEGACY_CREDITS_PER_DOLLAR || 13);
  return Math.max(1, Math.floor((amountPaidCents / 100) * perDollar));
}

/** Parse credits_per_month from Stripe metadata (v1 subs stored this on the product/sub). */
export function parseCreditsPerMonthFromMeta(...sources: Array<Record<string, string> | undefined>): number {
  for (const src of sources) {
    if (!src) continue;
    const raw = src.credits_per_month ?? src.creditsPerMonth;
    if (raw != null && raw !== "") {
      const n = parseInt(String(raw), 10);
      if (n > 0) return n;
    }
  }
  return 0;
}

/**
 * Resolve subscription ID from an invoice (Stripe Basil+ moved this off invoice.subscription).
 * @see https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects
 */
export function getInvoiceSubscriptionId(invoice: any): string | null {
  const top = invoice?.subscription;
  if (typeof top === "string" && top.startsWith("sub_")) return top;
  if (top?.id) return top.id;

  const parent = invoice?.parent;
  if (parent?.type === "subscription_details") {
    const sub = parent?.subscription_details?.subscription;
    if (typeof sub === "string" && sub.startsWith("sub_")) return sub;
    if (sub?.id) return sub.id;
  }

  const nested = invoice?.subscription_details?.subscription;
  if (typeof nested === "string" && nested.startsWith("sub_")) return nested;
  if (nested?.id) return nested.id;

  return null;
}

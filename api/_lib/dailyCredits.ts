/**
 * Daily free credits per subscription tier.
 *
 * Until 2026-09-15 this was a flat 10 a day for every subscriber. That is 300
 * credits a month — twice the 150 a $9 basic subscription includes — so a basic
 * subscriber using both fully cost about $8.55 of GPU against about $6.91 left
 * after Stripe fees and the 17% capital repayment: a loss before spin or missions
 * were counted. 61 of 110 subscribers were on basic. Premium and above stayed
 * profitable either way.
 *
 * Each tier now gets roughly 60% of its own monthly allowance, spread across the
 * month. Daily can never outgrow the plan it rides on, and a bigger plan is a
 * visibly better deal rather than the same 10 a day.
 *
 * One source of truth: the daily cron pays from this table and the support bot
 * quotes it, so what users are told and what they receive cannot drift apart.
 */

export const DAILY_CREDITS_BY_TIER = {
  basic: 3,
  premium: 6,
  pro: 13,
  elite: 28,
} as const;

export type DailyTier = keyof typeof DAILY_CREDITS_BY_TIER;

/**
 * For a subscriber whose tier is not in the table — a renamed or legacy tier, or
 * a discount-only legacy subscriber with no tier at all. The lowest paid amount:
 * not zero, which would silently stop paying someone who is paying us, and not
 * the old flat 10, which would quietly reopen the loss this table closes.
 */
export const DAILY_CREDITS_FALLBACK: number = DAILY_CREDITS_BY_TIER.basic;

/** "premium-yearly" is paid the same as "premium". */
export function tierFamily(tier: string | null | undefined): string {
  return String(tier ?? "").trim().toLowerCase().split("-")[0];
}

/**
 * Own-property check, not `in`: `"toString" in DAILY_CREDITS_BY_TIER` is true via
 * the prototype, and a tier string should never be able to match that.
 */
export function isKnownDailyTier(tier: string | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(DAILY_CREDITS_BY_TIER, tierFamily(tier));
}

export function dailyCreditsForTier(tier: string | null | undefined, discountPct = 0): number {
  const family = tierFamily(tier);
  if (Object.prototype.hasOwnProperty.call(DAILY_CREDITS_BY_TIER, family)) {
    return DAILY_CREDITS_BY_TIER[family as DailyTier];
  }
  const subscriber = family !== "" || Number(discountPct) > 0;
  return subscriber ? DAILY_CREDITS_FALLBACK : 0;
}

/** For copy and the support bot: "basic 3, premium 6, pro 13, elite 28". */
export function describeDailyCredits(): string {
  return Object.entries(DAILY_CREDITS_BY_TIER)
    .map(([tier, n]) => `${tier} ${n}`)
    .join(", ");
}

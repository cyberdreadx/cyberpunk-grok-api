/**
 * XRGE Bank & Loyalty Tier logic for v1 API endpoints.
 *
 * Loyalty tiers are determined by cumulative XRGE spent (lifetime_spend).
 * Each tier grants a higher bonus percentage on credit purchases.
 *
 *   Bronze  (default)      → 30% bonus
 *   Silver  (≥ 50,000)     → 35% bonus
 *   Gold    (≥ 200,000)    → 42% bonus
 *   Diamond (≥ 1,000,000)  → 50% bonus
 */

export interface LoyaltyTier {
  id: string;
  name: string;
  minSpend: number;
  bonusPercent: number;
}

export const LOYALTY_TIERS: LoyaltyTier[] = [
  { id: "diamond", name: "Diamond", minSpend: 1_000_000, bonusPercent: 50 },
  { id: "gold",    name: "Gold",    minSpend: 200_000,   bonusPercent: 42 },
  { id: "silver",  name: "Silver",  minSpend: 50_000,    bonusPercent: 35 },
  { id: "bronze",  name: "Bronze",  minSpend: 0,         bonusPercent: 30 },
];

export function getTierForSpend(lifetimeSpend: number): LoyaltyTier {
  for (const tier of LOYALTY_TIERS) {
    if (lifetimeSpend >= tier.minSpend) return tier;
  }
  return LOYALTY_TIERS[LOYALTY_TIERS.length - 1];
}

export function getNextTier(currentTier: string): LoyaltyTier | null {
  const idx = LOYALTY_TIERS.findIndex((t) => t.id === currentTier);
  if (idx <= 0) return null;
  return LOYALTY_TIERS[idx - 1];
}

export const CREDIT_PACKAGES: Record<string, { credits: number; priceCents: number }> = {
  starter:    { credits: 50,   priceCents: 500 },
  pro:        { credits: 175,  priceCents: 1500 },
  mega:       { credits: 450,  priceCents: 3500 },
  ultra:      { credits: 1800, priceCents: 15000 },
  enterprise: { credits: 4000, priceCents: 30000 },
};

export interface BankUser {
  id: string;
  xrge_bank_balance: string;
  xrge_lifetime_spend: string;
  loyalty_tier: string;
  wallet_address: string | null;
}

export async function getBankUser(sql: any, userId: string): Promise<BankUser | null> {
  const rows = await sql`
    SELECT id, xrge_bank_balance, xrge_lifetime_spend, loyalty_tier, wallet_address
    FROM users WHERE id = ${userId}
  `;
  return rows[0] || null;
}

/**
 * Recalculate and persist the user's loyalty tier based on lifetime spend.
 * Returns the new tier.
 */
export async function refreshLoyaltyTier(sql: any, userId: string): Promise<LoyaltyTier> {
  const [row] = await sql`
    SELECT xrge_lifetime_spend FROM users WHERE id = ${userId}
  `;
  if (!row) throw new Error("User not found");

  const spend = parseFloat(row.xrge_lifetime_spend) || 0;
  const tier = getTierForSpend(spend);

  await sql`
    UPDATE users SET loyalty_tier = ${tier.id}, updated_at = now()
    WHERE id = ${userId}
  `;

  return tier;
}

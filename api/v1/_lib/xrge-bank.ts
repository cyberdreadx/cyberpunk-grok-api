/**
 * XRGE Bank & Loyalty Tier logic.
 *
 * Custodial bank: users deposit XRGE, spend from balance, withdraw.
 * Loyalty tiers: determined by cumulative XRGE spent (lifetime_spend).
 *
 *   Bronze  (default)           → 30% bonus
 *   Silver  (≥ 100,000,000)     → 35% bonus
 *   Gold    (≥ 500,000,000)     → 42% bonus
 *   Diamond (≥ 2,000,000,000)   → 50% bonus
 */

export interface LoyaltyTier {
  id: string;
  name: string;
  minSpend: number;
  bonusPercent: number;
}

export const LOYALTY_TIERS: LoyaltyTier[] = [
  { id: "diamond", name: "Diamond", minSpend: 2_000_000_000, bonusPercent: 50 },
  { id: "gold",    name: "Gold",    minSpend: 500_000_000,   bonusPercent: 42 },
  { id: "silver",  name: "Silver",  minSpend: 100_000_000,   bonusPercent: 35 },
  { id: "bronze",  name: "Bronze",  minSpend: 0,             bonusPercent: 30 },
];

export function getTierForSpend(lifetimeSpend: number): LoyaltyTier {
  for (const tier of LOYALTY_TIERS) {
    if (lifetimeSpend >= tier.minSpend) return tier;
  }
  return LOYALTY_TIERS[LOYALTY_TIERS.length - 1];
}

export function getNextTier(currentTierId: string): LoyaltyTier | null {
  const idx = LOYALTY_TIERS.findIndex(t => t.id === currentTierId);
  if (idx <= 0) return null; // already at diamond or not found
  return LOYALTY_TIERS[idx - 1];
}

/**
 * Recalculate and persist the user's loyalty tier based on lifetime spend.
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

export interface BankUser {
  userId: string;
  bankBalance: number;
  lifetimeSpend: number;
  loyaltyTier: string;
  walletAddress: string | null;
}

/**
 * Fetch bank-related columns for a user.
 */
export async function getBankUser(sql: any, userId: string): Promise<BankUser | null> {
  const [row] = await sql`
    SELECT id, xrge_bank_balance, xrge_lifetime_spend, loyalty_tier, wallet_address
    FROM users WHERE id = ${userId}
  `;
  if (!row) return null;
  return {
    userId: row.id,
    bankBalance: parseFloat(row.xrge_bank_balance) || 0,
    lifetimeSpend: parseFloat(row.xrge_lifetime_spend) || 0,
    loyaltyTier: row.loyalty_tier || "bronze",
    walletAddress: row.wallet_address || null,
  };
}

export const CREDIT_PACKAGES: Record<string, { credits: number; priceCents: number }> = {
  starter:    { credits: 50,   priceCents: 500 },
  pro:        { credits: 175,  priceCents: 1500 },
  mega:       { credits: 450,  priceCents: 3500 },
  ultra:      { credits: 2200, priceCents: 15000 },
  enterprise: { credits: 4500, priceCents: 30000 },
};

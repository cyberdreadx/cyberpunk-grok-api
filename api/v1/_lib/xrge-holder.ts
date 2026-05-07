/**
 * XRGE Holder Tier system.
 *
 * Rewards continuous HOLDING of XRGE (on-chain + bank balance combined),
 * complementing the existing spend-based loyalty tier system.
 *
 * Tiers (XRGE held):
 *   none      (< 1M)          — no perks, prompt to start holding
 *   initiate  (≥ 1M)          — +5%  gen discount
 *   operative (≥ 10M)         — +10% discount, +2  daily credits
 *   runner    (≥ 50M)         — +15% discount, +5  daily credits, NSFW LoRA unlocked
 *   architect (≥ 250M)        — +25% discount, +10 daily credits, GLTCH PRO unlocked
 *
 * Continuous-hold streak multiplier (applied to perks above):
 *   30+ days   → 1.25×
 *   90+ days   → 1.50×
 *   180+ days  → 2.00×
 * Selling below the tier threshold resets the streak.
 *
 * Tiers are XRGE-denominated (not USD) to reward early/loyal holders
 * even as price moves. We can switch to USD-denomination later if
 * accessibility for new users becomes a concern.
 */

export interface HolderTier {
  id: string;
  name: string;
  rank: number; // 0 = none, 4 = top
  minHeld: number;
  discountPercent: number;
  dailyCreditBonus: number;
  description: string;
}

export const HOLDER_TIERS: HolderTier[] = [
  {
    id: "architect",
    name: "Architect",
    rank: 4,
    minHeld: 250_000_000,
    discountPercent: 25,
    dailyCreditBonus: 10,
    description: "GLTCH PRO unlocked, exclusive holder LoRAs, +25% gen discount, +10 daily credits",
  },
  {
    id: "runner",
    name: "Runner",
    rank: 3,
    minHeld: 50_000_000,
    discountPercent: 15,
    dailyCreditBonus: 5,
    description: "NSFW LoRA unlocked while held, +15% discount, +5 daily credits",
  },
  {
    id: "operative",
    name: "Operative",
    rank: 2,
    minHeld: 10_000_000,
    discountPercent: 10,
    dailyCreditBonus: 2,
    description: "+10% discount on credit purchases, +2 daily credits",
  },
  {
    id: "initiate",
    name: "Initiate",
    rank: 1,
    minHeld: 1_000_000,
    discountPercent: 5,
    dailyCreditBonus: 0,
    description: "+5% discount on credit purchases",
  },
  {
    id: "none",
    name: "—",
    rank: 0,
    minHeld: 0,
    discountPercent: 0,
    dailyCreditBonus: 0,
    description: "Hold ≥ 1M XRGE to unlock holder perks",
  },
];

export function getHolderTier(totalHeld: number): HolderTier {
  for (const tier of HOLDER_TIERS) {
    if (totalHeld >= tier.minHeld) return tier;
  }
  return HOLDER_TIERS[HOLDER_TIERS.length - 1];
}

export function getNextHolderTier(currentTierId: string): HolderTier | null {
  const idx = HOLDER_TIERS.findIndex((t) => t.id === currentTierId);
  // Top tier or unknown id
  if (idx <= 0) return null;
  return HOLDER_TIERS[idx - 1];
}

export function tierRank(tierId: string): number {
  return HOLDER_TIERS.find((t) => t.id === tierId)?.rank ?? 0;
}

export interface StreakBonus {
  days: number;
  multiplier: number;
  label: string;
}

export const STREAK_BONUSES: StreakBonus[] = [
  { days: 180, multiplier: 2.0, label: "Diamond Hands" },
  { days: 90, multiplier: 1.5, label: "Veteran" },
  { days: 30, multiplier: 1.25, label: "Committed" },
  { days: 0, multiplier: 1.0, label: "Standard" },
];

export function getStreakBonus(streakDays: number): StreakBonus {
  for (const bonus of STREAK_BONUSES) {
    if (streakDays >= bonus.days) return bonus;
  }
  return STREAK_BONUSES[STREAK_BONUSES.length - 1];
}

export interface HolderState {
  tier: HolderTier;
  totalHeld: number;
  walletBalance: number;
  bankBalance: number;
  walletAddress: string | null;
  streakDays: number;
  streakBonus: StreakBonus;
  effectiveDiscount: number; // discountPercent × multiplier (rounded 1dp)
  effectiveDailyBonus: number; // dailyCreditBonus × multiplier (floored)
  lastSnapshotAt: Date | null;
  nextTier: HolderTier | null;
  spendToNext: number; // XRGE needed to reach next tier (0 if at top or none→initiate calc)
}

/**
 * Read holder state for a user using their LATEST snapshot.
 * Falls back to current bank balance if no snapshot exists yet.
 */
export async function getHolderState(sql: any, userId: string): Promise<HolderState | null> {
  const [row] = await sql`
    SELECT
      u.wallet_address,
      u.xrge_bank_balance,
      u.holder_tier,
      u.holder_tier_since,
      u.last_snapshot_at,
      u.last_snapshot_total,
      p.wallet_address AS profile_wallet
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ${userId}
  `;
  if (!row) return null;

  const bankBalance = parseFloat(row.xrge_bank_balance) || 0;
  const lastTotal = parseFloat(row.last_snapshot_total) || 0;
  // walletBalance = total snapshot - bank at snapshot time. The bank may have
  // changed since the snapshot, but that's only a UI-side estimate; the cron
  // re-derives both fresh.
  const walletBalance = Math.max(0, lastTotal - bankBalance);

  const wallet = row.wallet_address || row.profile_wallet || null;
  const totalHeld = lastTotal > 0 ? lastTotal : bankBalance;

  const tier = HOLDER_TIERS.find((t) => t.id === row.holder_tier) || getHolderTier(totalHeld);
  const nextTier = getNextHolderTier(tier.id);

  let streakDays = 0;
  if (row.holder_tier_since && tier.id !== "none") {
    const since = new Date(row.holder_tier_since).getTime();
    if (!Number.isNaN(since)) {
      streakDays = Math.max(0, Math.floor((Date.now() - since) / (1000 * 60 * 60 * 24)));
    }
  }
  const streakBonus = getStreakBonus(streakDays);

  return {
    tier,
    totalHeld,
    walletBalance,
    bankBalance,
    walletAddress: wallet ? String(wallet).toLowerCase() : null,
    streakDays,
    streakBonus,
    effectiveDiscount: Math.round(tier.discountPercent * streakBonus.multiplier * 10) / 10,
    effectiveDailyBonus: Math.floor(tier.dailyCreditBonus * streakBonus.multiplier),
    lastSnapshotAt: row.last_snapshot_at ? new Date(row.last_snapshot_at) : null,
    nextTier,
    spendToNext: nextTier ? Math.max(0, nextTier.minHeld - totalHeld) : 0,
  };
}

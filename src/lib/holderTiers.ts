/**
 * Client-side mirror of the XRGE Holder tier ladder.
 * Source of truth: api/v1/_lib/xrge-holder.ts — keep in sync.
 */
export interface HolderTierInfo {
  id: "none" | "initiate" | "operative" | "runner" | "architect";
  name: string;
  rank: number;
  minHeld: number;
  discountPercent: number;
  dailyCreditBonus: number;
  description: string;
}

export const HOLDER_TIERS: HolderTierInfo[] = [
  {
    id: "architect",
    name: "Architect",
    rank: 4,
    minHeld: 250_000_000,
    discountPercent: 25,
    dailyCreditBonus: 10,
    description: "GLTCH PRO + holder LoRAs, +25% discount, +10 daily credits",
  },
  {
    id: "runner",
    name: "Runner",
    rank: 3,
    minHeld: 50_000_000,
    discountPercent: 15,
    dailyCreditBonus: 5,
    description: "NSFW LoRA unlocked, +15% discount, +5 daily credits",
  },
  {
    id: "operative",
    name: "Operative",
    rank: 2,
    minHeld: 10_000_000,
    discountPercent: 10,
    dailyCreditBonus: 2,
    description: "+10% discount, +2 daily credits",
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

export interface StreakBonusInfo {
  days: number;
  multiplier: number;
  label: string;
  description: string;
}

export const STREAK_BONUSES: StreakBonusInfo[] = [
  { days: 0,   multiplier: 1.0,  label: "Standard",     description: "Hold any qualifying amount" },
  { days: 30,  multiplier: 1.25, label: "Committed",    description: "30 days continuous hold" },
  { days: 90,  multiplier: 1.5,  label: "Veteran",      description: "90 days continuous hold" },
  { days: 180, multiplier: 2.0,  label: "Diamond Hands", description: "180 days continuous hold" },
];

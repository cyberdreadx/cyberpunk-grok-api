/**
 * Supabase client for auth, credit balance, and edge function calls.
 *
 * The SUPABASE_URL and SUPABASE_ANON_KEY are public (safe to embed in client code).
 * They only grant access through Row Level Security policies.
 *
 * Set these in your .env file:
 *   VITE_SUPABASE_URL=https://your-project.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJ...
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Gracefully handle missing env vars (app still works in BYOK mode without Supabase)
export const supabaseEnabled = !!(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseEnabled
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

// ── Credit cost configuration ────────────────────────────────────────────

export const CREDIT_COSTS = {
  /** 1 credit per image generated or edited */
  image: 1,
  /** 1 credit per second of video */
  videoPerSecond: 1,
} as const;

/** Calculate credit cost for a given action. */
export function calculateCreditCost(
  mode: "text-to-image" | "edit-image" | "text-to-video" | "image-to-video",
  imageCount: number = 1,
  videoDurationSeconds: number = 5,
): number {
  switch (mode) {
    case "text-to-image":
    case "edit-image":
      return CREDIT_COSTS.image * imageCount;
    case "text-to-video":
    case "image-to-video":
      return CREDIT_COSTS.videoPerSecond * videoDurationSeconds;
    default:
      return 1;
  }
}

// ── Monthly subscription tiers ───────────────────────────────────────────

export interface SubscriptionTier {
  id: "basic" | "premium";
  name: string;
  creditsPerMonth: number;
  priceCents: number; // monthly price in cents
  perCredit: string;
  popular?: boolean;
}

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  { id: "basic", name: "BASIC", creditsPerMonth: 150, priceCents: 999, perCredit: "$0.067" },
  { id: "premium", name: "PREMIUM", creditsPerMonth: 500, priceCents: 2499, perCredit: "$0.050", popular: true },
];

// ── One-time credit packs ────────────────────────────────────────────────

export interface CreditPackage {
  id: "starter" | "pro" | "mega";
  name: string;
  credits: number;
  priceCents: number;
  perCredit: string;
  popular?: boolean;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "starter", name: "STARTER", credits: 50, priceCents: 500, perCredit: "$0.10" },
  { id: "pro", name: "PRO", credits: 175, priceCents: 1500, perCredit: "$0.086", popular: true },
  { id: "mega", name: "MEGA", credits: 450, priceCents: 3500, perCredit: "$0.078" },
];

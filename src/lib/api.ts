/**
 * API client for auth, credits, and generation proxy.
 * Replaces Supabase client — calls our own Vercel serverless functions.
 */

// ── API base URL ─────────────────────────────────────────────────────────
// Production (Vercel): same origin — `/api` hits serverless routes.
// Local dev: set `VITE_API_URL` to full API base, OR leave unset — Vite proxies `/api` → backend (see vite.config).
const API_BASE = import.meta.env.VITE_API_URL || "/api";

/** Whether the backend is configured (always true if deployed on Vercel). */
export const backendEnabled = true;

// ── Auth token management ────────────────────────────────────────────────

const TOKEN_KEY = "auth-token";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasAuthToken(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

// ── Generic fetch wrapper ────────────────────────────────────────────────

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean; // include JWT token (default true)
}

export async function apiFetch<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const fetchOptions: RequestInit = { method, headers, credentials: "include" };
  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, fetchOptions);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `HTTP ${res.status}`;
    try {
      const data = JSON.parse(text) as { error?: string; message?: string };
      message = data.error || data.message || message;
    } catch {
      // Proxies / gateways often return HTML or plain text on 502/413
      const t = text.trim();
      if (t) message = t.slice(0, 800);
    }
    throw new Error(message);
  }

  return res.json();
}

// ── Credit cost configuration ────────────────────────────────────────────

export const CREDIT_COSTS = {
  /** 4 credits per image generated (Grok standard — 2x operational overhead) */
  imageGen: 4,
  /** 6 credits per image edited (Grok standard — 2x operational overhead) */
  imageEdit: 6,
  /** 10 credits per image generated (Grok Pro — 2x operational overhead) */
  imageGenPro: 10,
  /** 12 credits per image edited (Grok Pro — 2x operational overhead) */
  imageEditPro: 12,
  /** 2K resolution surcharge: double the base rate */
  imageGen2k: 8,
  imageEdit2k: 12,
  imageGenPro2k: 20,
  imageEditPro2k: 24,
  /** 6 credits per second of video (xAI — 2x operational overhead) */
  videoPerSecond: 6,
  /** 3 credits per GLTCH modify/edit */
  gltchEdit: 3,
  /** 4 credits per GLTCH edit with HD upscale */
  gltchEditHd: 4,
  comfyImage: 3,
  comfyEdit: 3,
  comfyEditHd: 4,
  comfyVideo: 15,
  comfyLongLook: 20,
} as const;

export type CreditMode =
  | "text-to-image" | "edit-image" | "text-to-image-pro" | "edit-image-pro"
  | "text-to-image-2k" | "edit-image-2k" | "text-to-image-pro-2k" | "edit-image-pro-2k"
  | "text-to-video" | "image-to-video" | "edit-video"
  | "gltch-edit" | "gltch-edit-hd"
  | "comfy-image" | "comfy-image-hd" | "comfy-edit" | "comfy-edit-hd" | "comfy-video" | "comfy-longlook";

/** Calculate credit cost for a given action. */
export function calculateCreditCost(
  mode: CreditMode,
  imageCount: number = 1,
  videoDurationSeconds: number = 5,
): number {
  switch (mode) {
    case "text-to-image":
      return CREDIT_COSTS.imageGen * imageCount;
    case "edit-image":
      return CREDIT_COSTS.imageEdit * imageCount;
    case "text-to-image-pro":
      return CREDIT_COSTS.imageGenPro * imageCount;
    case "edit-image-pro":
      return CREDIT_COSTS.imageEditPro * imageCount;
    case "text-to-image-2k":
      return CREDIT_COSTS.imageGen2k * imageCount;
    case "edit-image-2k":
      return CREDIT_COSTS.imageEdit2k * imageCount;
    case "text-to-image-pro-2k":
      return CREDIT_COSTS.imageGenPro2k * imageCount;
    case "edit-image-pro-2k":
      return CREDIT_COSTS.imageEditPro2k * imageCount;
    case "text-to-video":
    case "image-to-video":
    case "edit-video":
      return CREDIT_COSTS.videoPerSecond * videoDurationSeconds;
    case "gltch-edit":
      return CREDIT_COSTS.gltchEdit;
    case "gltch-edit-hd":
      return CREDIT_COSTS.gltchEditHd;
    case "comfy-image":
      return CREDIT_COSTS.comfyImage;
    case "comfy-image-hd":
      return CREDIT_COSTS.comfyEditHd;
    case "comfy-edit":
      return CREDIT_COSTS.comfyEdit;
    case "comfy-edit-hd":
      return CREDIT_COSTS.comfyEditHd;
    case "comfy-video":
      return CREDIT_COSTS.comfyVideo;
    case "comfy-longlook":
      return CREDIT_COSTS.comfyLongLook * imageCount;
    default:
      return 1;
  }
}

// ── Subscription tiers ───────────────────────────────────────────────────

export interface SubscriptionTier {
  id: string;
  name: string;
  creditsPerMonth: number;
  priceCents: number;
  perCredit: string;
  popular?: boolean;
  interval: "month" | "year";
  /** For yearly: equivalent monthly price for display */
  monthlyEquivalentCents?: number;
  /** Savings vs monthly */
  savingsPercent?: number;
}

/** Tier rank for upgrade/downgrade logic (higher = better) */
export const TIER_RANK: Record<string, number> = {
  basic: 1, "basic-yearly": 1,
  premium: 2, "premium-yearly": 2,
  pro: 3, "pro-yearly": 3,
  elite: 4, "elite-yearly": 4,
};

export const SUBSCRIPTION_TIERS_MONTHLY: SubscriptionTier[] = [
  { id: "basic", name: "BASIC", creditsPerMonth: 150, priceCents: 999, perCredit: "$0.067", interval: "month" },
  { id: "premium", name: "PREMIUM", creditsPerMonth: 500, priceCents: 2499, perCredit: "$0.050", popular: true, interval: "month" },
  { id: "pro", name: "PRO", creditsPerMonth: 2000, priceCents: 7999, perCredit: "$0.040", interval: "month" },
  { id: "elite", name: "ELITE", creditsPerMonth: 10000, priceCents: 29999, perCredit: "$0.030", interval: "month" },
];

export const SUBSCRIPTION_TIERS_YEARLY: SubscriptionTier[] = [
  { id: "basic-yearly", name: "BASIC", creditsPerMonth: 150, priceCents: 10548, perCredit: "$0.059", interval: "year", monthlyEquivalentCents: 879, savingsPercent: 12 },
  { id: "premium-yearly", name: "PREMIUM", creditsPerMonth: 500, priceCents: 26388, perCredit: "$0.044", popular: true, interval: "year", monthlyEquivalentCents: 2199, savingsPercent: 12 },
  { id: "pro-yearly", name: "PRO", creditsPerMonth: 2000, priceCents: 84468, perCredit: "$0.035", interval: "year", monthlyEquivalentCents: 7039, savingsPercent: 12 },
  { id: "elite-yearly", name: "ELITE", creditsPerMonth: 10000, priceCents: 316788, perCredit: "$0.026", interval: "year", monthlyEquivalentCents: 26399, savingsPercent: 12 },
];

/** Combined for backward compat */
export const SUBSCRIPTION_TIERS: SubscriptionTier[] = SUBSCRIPTION_TIERS_MONTHLY;

// ── One-time credit packs ────────────────────────────────────────────────

export interface CreditPackage {
  id: string;
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
  { id: "ultra", name: "ULTRA", credits: 2200, priceCents: 15000, perCredit: "$0.068" },
  { id: "enterprise", name: "ENTERPRISE", credits: 4500, priceCents: 30000, perCredit: "$0.067" },
];

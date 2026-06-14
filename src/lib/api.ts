/**
 * API client for auth, credits, and generation proxy.
 * Replaces Supabase client — calls our own Vercel serverless functions.
 */

// ── API base URL ─────────────────────────────────────────────────────────
// Production (Vercel): same origin — `/api` hits serverless routes.
// Lovable preview hosts do not serve the backend, so they must call the deployed API directly.
// Local dev: set `VITE_API_URL` to full API base, OR leave unset — Vite proxies `/api` → backend (see vite.config).
const PREVIEW_API_BASE = "https://cyberpunk-grok-api.vercel.app/api";
const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
const isLovablePreviewHost = currentHost.endsWith(".lovable.app") || currentHost.endsWith(".lovableproject.com");
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "/api" : (isLovablePreviewHost ? PREVIEW_API_BASE : "/api"));
const isSameOriginApi = API_BASE.startsWith("/") || API_BASE.startsWith(currentOrigin);

/** Resolved API base (e.g. "/api" or "https://your-app.vercel.app/api"). Use for direct fetch() calls. */
export const API_BASE_URL = API_BASE;
/** Whether the API is same-origin — controls fetch credentials. */
export const apiIsSameOrigin = isSameOriginApi;
/** Build a full API URL for a sub-path (e.g. apiUrl("/download") → "/api/download"). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

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
  /** Extra headers to merge in (e.g. Idempotency-Key). */
  headers?: Record<string, string>;
}

export async function apiFetch<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, headers: extraHeaders } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extraHeaders || {}),
  };

  if (auth) {
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  // Only include credentials for auth endpoints that rely on the cross-origin
  // `td` (trusted-device) cookie (login / 2FA). Email signup verification uses
  // only JSON body + JWT — `credentials: "include"` with `Allow-Origin: *`
  // would block the response on cross-origin previews (Safari: "Load failed").
  const needsCredentials =
    isSameOriginApi || /^\/auth\/(login|verify-2fa|two-factor)/.test(path);
  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: needsCredentials ? "include" : "omit",
  };
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
  | "text-to-video" | "image-to-video"
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
  /**
   * @deprecated Subscriptions no longer grant monthly credits.
   * Kept on the type for back-compat with old UI; always 0 going forward.
   */
  creditsPerMonth: number;
  priceCents: number;
  /** Per-generation discount % while sub is active. 15/30/50/70. */
  discountPercent: number;
  /** Example: "Save $X on a 10-credit edit" */
  exampleSavings?: string;
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

/** Discount % for each tier id. Single source of truth. */
export const TIER_DISCOUNT: Record<string, number> = {
  basic: 15, "basic-yearly": 15,
  premium: 30, "premium-yearly": 30,
  pro: 50, "pro-yearly": 50,
  elite: 70, "elite-yearly": 70,
};

// Repriced to community-validated anchors: $9 / $19 / $39 / $79.
// Pricing ladder matches the four buyer personas: casual / regular / hobbyist / power.
// NOTE: Stripe price IDs (STRIPE_PRICE_SUB_*) must be re-created in Stripe to match
// these amounts — the UI numbers are display-only until those env vars are swapped.
export const SUBSCRIPTION_TIERS_MONTHLY: SubscriptionTier[] = [
  { id: "basic",   name: "CASUAL",     creditsPerMonth: 150,  priceCents: 900,  discountPercent: 0, interval: "month" },
  { id: "premium", name: "REGULAR",    creditsPerMonth: 325,  priceCents: 1900, discountPercent: 0, popular: true, interval: "month" },
  { id: "pro",     name: "HOBBYIST",   creditsPerMonth: 675,  priceCents: 3900, discountPercent: 0, interval: "month" },
  { id: "elite",   name: "POWER USER", creditsPerMonth: 1400, priceCents: 7900, discountPercent: 0, interval: "month" },
];

// Yearly: 12% savings vs monthly × 12. creditsPerMonth shown is the monthly figure;
// yearly invoices grant 12× up front (see api/_lib/stripe-sub-prices computeSubCreditGrant).
export const SUBSCRIPTION_TIERS_YEARLY: SubscriptionTier[] = [
  { id: "basic-yearly",   name: "CASUAL",     creditsPerMonth: 150,  priceCents: 9504,  discountPercent: 0, interval: "year", monthlyEquivalentCents: 792,  savingsPercent: 12 },
  { id: "premium-yearly", name: "REGULAR",    creditsPerMonth: 325,  priceCents: 20064, discountPercent: 0, popular: true, interval: "year", monthlyEquivalentCents: 1672, savingsPercent: 12 },
  { id: "pro-yearly",     name: "HOBBYIST",   creditsPerMonth: 675,  priceCents: 41184, discountPercent: 0, interval: "year", monthlyEquivalentCents: 3432, savingsPercent: 12 },
  { id: "elite-yearly",   name: "POWER USER", creditsPerMonth: 1400, priceCents: 83424, discountPercent: 0, interval: "year", monthlyEquivalentCents: 6952, savingsPercent: 12 },
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

// Repriced to absorb Stripe's 17.5% loan deduction without users feeling a hike:
// every pack now offers MORE credits at a slightly higher price, so the per-credit
// cost actually drops or stays flat. Marketing line: "More credits, lower per-credit price."
export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "starter",    name: "STARTER",    credits: 75,   priceCents: 699,   perCredit: "$0.093" },
  { id: "pro",        name: "PRO",        credits: 240,  priceCents: 1899,  perCredit: "$0.079", popular: true },
  { id: "mega",       name: "MEGA",       credits: 600,  priceCents: 4299,  perCredit: "$0.072" },
  { id: "ultra",      name: "ULTRA",      credits: 2600, priceCents: 17999, perCredit: "$0.069" },
  { id: "enterprise", name: "ENTERPRISE", credits: 5400, priceCents: 35999, perCredit: "$0.067" },
];

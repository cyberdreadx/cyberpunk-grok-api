/**
 * API client for auth, credits, and generation proxy.
 * Replaces Supabase client — calls our own Vercel serverless functions.
 */

// ── API base URL ─────────────────────────────────────────────────────────
// In production: same origin (Vercel serves both frontend + /api routes)
// In dev: Vite proxy or direct URL
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
  method?: "GET" | "POST" | "PUT" | "DELETE";
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

  const fetchOptions: RequestInit = { method, headers };
  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, fetchOptions);

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || data.message || `API error: ${res.status}`);
  }

  return res.json();
}

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
  priceCents: number;
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

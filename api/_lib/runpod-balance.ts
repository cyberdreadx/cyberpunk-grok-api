/**
 * RunPod account balance reader.
 *
 * Reads the account credit balance via RunPod's GraphQL API. This needs an
 * ACCOUNT-scoped API key (RUNPOD_ACCOUNT_API_KEY) — the job-scoped key in
 * RUNPOD_API_KEY (rpa_…) 401s on GraphQL/management and can only hit
 * api.runpod.ai/v2/{id}/health and /run.
 *
 * Result is cached in-memory so the public /api/runpod-status endpoint can be
 * polled cheaply without hammering RunPod (and without blocking on every hit).
 */

export interface RunpodBalance {
  /** Account credit balance in USD. */
  balanceUsd: number;
  /** Current spend rate in USD/hr (reflects only currently-running workers). */
  spendPerHr: number;
}

const CACHE_TTL_MS = 60_000; // 60s — balance changes slowly
let cache: { value: RunpodBalance | null; at: number } | null = null;
let inflight: Promise<RunpodBalance | null> | null = null;

function accountKey(): string {
  return (process.env.RUNPOD_ACCOUNT_API_KEY || "").trim();
}

/** Whether an account-scoped key is configured (so callers can show "unknown"). */
export function isRunpodBalanceConfigured(): boolean {
  return accountKey().length > 0;
}

async function runQuery(key: string, query: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`https://api.runpod.io/graphql?api_key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.error(`[runpod-balance] GraphQL HTTP ${resp.status}`);
      return null;
    }
    return await resp.json();
  } catch (err: any) {
    console.error("[runpod-balance] fetch failed:", err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function queryRunpod(): Promise<RunpodBalance | null> {
  const key = accountKey();
  if (!key) return null;

  // Prefer balance + spend rate; if RunPod rejects the spend field, the whole
  // query errors, so fall back to balance-only — the light must not go dark
  // just because one optional field changed name.
  let json = await runQuery(key, "query { myself { clientBalance currentSpendPerHr } }");
  let me = json?.data?.myself;
  if (json?.errors || !me || typeof me.clientBalance !== "number") {
    json = await runQuery(key, "query { myself { clientBalance } }");
    me = json?.data?.myself;
  }

  if (!me || typeof me.clientBalance !== "number") {
    if (json) console.error("[runpod-balance] unexpected GraphQL response:", JSON.stringify(json).slice(0, 200));
    return null;
  }
  return {
    balanceUsd: me.clientBalance,
    spendPerHr: typeof me.currentSpendPerHr === "number" ? me.currentSpendPerHr : 0,
  };
}

/**
 * Get the RunPod balance, served from a 60s cache. Returns null when no
 * account key is configured or the lookup fails (caller renders "unknown").
 * On a transient failure we keep serving the last good value within the TTL.
 */
export async function getRunpodBalance(): Promise<RunpodBalance | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const value = await queryRunpod();
    // On failure, keep a recent good value if we have one (avoids flapping).
    if (value === null && cache && cache.value && now - cache.at < CACHE_TTL_MS * 5) {
      inflight = null;
      return cache.value;
    }
    cache = { value, at: Date.now() };
    inflight = null;
    return value;
  })();
  return inflight;
}

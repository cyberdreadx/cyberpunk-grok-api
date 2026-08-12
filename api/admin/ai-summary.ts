/**
 * /api/admin/ai-summary — Admin-only AI executive summary.
 *
 * GET            → Returns cached summary + raw stats (if exists).
 * POST { stream } → Aggregates fresh stats, calls DeepSeek (preferred) or Lovable AI Gateway, streams tokens.
 *                   Persists final markdown + stats blob to app_config (key='admin_ai_summary')
 *                   so the next GET returns it instantly. Cached 1h server-side.
 *
 * Auth: same admin gate as other /api/admin/* routes (server-side ADMIN_EMAIL match).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db";
import { getUserFromRequest, ADMIN_EMAIL } from "../_lib/auth";
import { applyCors } from "../_lib/cors";

const CACHE_KEY = "admin_ai_summary";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";
const DEEPSEEK_MODEL = process.env.ADMIN_AI_SUMMARY_MODEL || "deepseek-v4-flash";

function resolveAiConfig(): { url: string; apiKey: string; model: string; provider: "deepseek" | "lovable" } | null {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    return { url: DEEPSEEK_URL, apiKey: deepseekKey, model: DEEPSEEK_MODEL, provider: "deepseek" };
  }
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    return { url: LOVABLE_GATEWAY_URL, apiKey: lovableKey, model: LOVABLE_MODEL, provider: "lovable" };
  }
  return null;
}

function isAdmin(req: VercelRequest): boolean {
  const auth = getUserFromRequest(req);
  return !!auth && auth.email === ADMIN_EMAIL;
}

async function aggregateStats(sql: ReturnType<typeof getDb>) {
  const safe = async <T,>(p: Promise<T>, fb: T): Promise<T> => {
    try { return await p; } catch { return fb; }
  };

  // ── Revenue & monetization ──
  const [revenue] = await safe(sql`
    SELECT
      COALESCE(SUM(amount_cents), 0)::int AS total_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::int AS today_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= date_trunc('week', now())), 0)::int AS week_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::int AS month_cents,
      COUNT(*)::int AS total_tx,
      COUNT(*) FILTER (WHERE type = 'pack')::int AS pack_tx,
      COUNT(*) FILTER (WHERE type = 'subscription')::int AS sub_tx,
      COUNT(DISTINCT user_id)::int AS paying_users
    FROM transactions
    WHERE amount_cents > 0
  `, [{ total_cents: 0, today_cents: 0, week_cents: 0, month_cents: 0, total_tx: 0, pack_tx: 0, sub_tx: 0, paying_users: 0 }]);

  // ── Users / growth ──
  const [users] = await safe(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS new_today,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('week', now()))::int AS new_week,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_month,
      COUNT(*) FILTER (WHERE email_verified = true)::int AS verified,
      COUNT(*) FILTER (WHERE subscription_tier IS NOT NULL)::int AS subscribers,
      COUNT(*) FILTER (WHERE subscription_tier IS NOT NULL AND subscription_cancel_at IS NOT NULL)::int AS cancelling
    FROM users
  `, [{ total: 0, new_today: 0, new_week: 0, new_month: 0, verified: 0, subscribers: 0, cancelling: 0 }]);

  // ── Active users (from usage_log) ──
  const [active] = await safe(sql`
    SELECT
      COUNT(DISTINCT user_id) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS dau,
      COUNT(DISTINCT user_id) FILTER (WHERE created_at >= date_trunc('week', now()))::int AS wau,
      COUNT(DISTINCT user_id) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS mau
    FROM usage_log
    WHERE mode NOT IN ('share','share-repeat','chat-message','goodwill-discount-rounding')
  `, [{ dau: 0, wau: 0, mau: 0 }]);

  // ── Generation usage & cost ──
  const [usage] = await safe(sql`
    SELECT
      COUNT(*) FILTER (WHERE mode NOT LIKE '%-refunded%')::int AS total_gens,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS gens_today,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('week', now()))::int AS gens_week,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS gens_month,
      COALESCE(SUM(CASE WHEN mode LIKE '%-refunded%' THEN 0 ELSE credits_used END), 0)::int AS credits_total,
      COALESCE(SUM(CASE WHEN mode LIKE '%-refunded%' THEN 0 ELSE credits_used END)
               FILTER (WHERE created_at >= date_trunc('month', now())), 0)::int AS credits_month
    FROM usage_log
    WHERE mode NOT IN ('share','share-repeat','chat-message','goodwill-discount-rounding')
      AND mode NOT LIKE '%-refunded%'
  `, [{ total_gens: 0, gens_today: 0, gens_week: 0, gens_month: 0, credits_total: 0, credits_month: 0 }]);

  const topModes = await safe(sql`
    SELECT split_part(mode, '-refunded', 1) AS mode,
           COUNT(*) FILTER (WHERE mode NOT LIKE '%-refunded%')::int AS n,
           COALESCE(SUM(CASE WHEN mode LIKE '%-refunded%' THEN 0 ELSE credits_used END),0)::int AS credits
    FROM usage_log
    WHERE created_at >= now() - interval '30 days'
      AND mode NOT IN ('share','share-repeat','chat-message','goodwill-discount-rounding')
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 8
  `, [] as any[]);

  // Actual API cost if tracked
  const [costs] = await safe(sql`
    SELECT
      COALESCE(SUM(api_cost_cents), 0)::numeric AS total_cost_cents,
      COALESCE(SUM(api_cost_cents) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::numeric AS month_cost_cents
    FROM usage_log
  `, [{ total_cost_cents: 0, month_cost_cents: 0 }]);

  // ── Creator economy ──
  const creatorTop = await safe(sql`
    SELECT
      COALESCE(p.username, LEFT(u.email, 6) || '***') AS name,
      COALESCE(SUM(fu.credits_paid), 0)::int AS credits_earned,
      COALESCE(SUM(fu.cents_paid), 0)::int AS cents_earned,
      COUNT(fu.*)::int AS unlocks
    FROM feed_unlocks fu
    JOIN feed_posts fp ON fp.id = fu.post_id
    JOIN users u ON u.id = fp.user_id
    LEFT JOIN profiles p ON p.user_id = u.id
    GROUP BY u.id, u.email, p.username
    ORDER BY (COALESCE(SUM(fu.cents_paid),0) + COALESCE(SUM(fu.credits_paid),0)*5) DESC
    LIMIT 10
  `, [] as any[]);

  const [creatorTotals] = await safe(sql`
    SELECT
      COALESCE(SUM(credits_paid), 0)::int AS total_credits_unlocked,
      COALESCE(SUM(cents_paid), 0)::int AS total_cents_unlocked,
      COUNT(*)::int AS total_unlocks
    FROM feed_unlocks
  `, [{ total_credits_unlocked: 0, total_cents_unlocked: 0, total_unlocks: 0 }]);

  const [creditPool] = await safe(sql`
    SELECT
      COALESCE(SUM(sub_credits), 0)::int AS sub_outstanding,
      COALESCE(SUM(pack_credits), 0)::int AS pack_outstanding,
      COALESCE(SUM(daily_credits), 0)::int AS daily_outstanding
    FROM users
  `, [{ sub_outstanding: 0, pack_outstanding: 0, daily_outstanding: 0 }]);

  // ── Daily time series for anomaly detection (last 30 days) ──
  const revSeries = await safe(sql`
    SELECT date_trunc('day', created_at)::date AS d,
           COALESCE(SUM(amount_cents), 0)::int AS v
    FROM transactions
    WHERE created_at >= now() - interval '30 days' AND amount_cents > 0
    GROUP BY 1 ORDER BY 1
  `, [] as { d: string; v: number }[]);

  const signupSeries = await safe(sql`
    SELECT date_trunc('day', created_at)::date AS d, COUNT(*)::int AS v
    FROM users
    WHERE created_at >= now() - interval '30 days'
    GROUP BY 1 ORDER BY 1
  `, [] as { d: string; v: number }[]);

  const activeSeries = await safe(sql`
    SELECT date_trunc('day', created_at)::date AS d,
           COUNT(DISTINCT user_id)::int AS v
    FROM usage_log
    WHERE created_at >= now() - interval '30 days'
      AND mode NOT IN ('share','share-repeat','chat-message','goodwill-discount-rounding')
    GROUP BY 1 ORDER BY 1
  `, [] as { d: string; v: number }[]);

  const genSeries = await safe(sql`
    SELECT date_trunc('day', created_at)::date AS d, COUNT(*)::int AS v
    FROM usage_log
    WHERE created_at >= now() - interval '30 days'
      AND mode NOT IN ('share','share-repeat','chat-message','goodwill-discount-rounding')
      AND mode NOT LIKE '%-refunded%'
    GROUP BY 1 ORDER BY 1
  `, [] as { d: string; v: number }[]);

  const anomalies = detectAnomalies({
    revenue_cents: revSeries,
    signups: signupSeries,
    active_users: activeSeries,
    generations: genSeries,
  });

  return {
    generated_at: new Date().toISOString(),
    revenue,
    users,
    active,
    usage,
    topModes,
    costs,
    creator: { totals: creatorTotals, top: creatorTop },
    creditPool,
    anomalies,
  };
}

// ── Anomaly detection ─────────────────────────────────────────────────
// Z-score today/yesterday vs the trailing 28-day baseline (excluding today).
// Flags |z| ≥ 2 as anomaly; ≥ 3 as severe. Also emits direction & % change vs avg.

export interface Anomaly {
  metric: string;          // human label
  key: string;             // machine key
  date: string;            // ISO date
  value: number;           // observed value
  baseline_avg: number;    // mean of trailing baseline
  baseline_stddev: number;
  z_score: number;
  pct_vs_avg: number;      // % delta vs baseline mean
  direction: "spike" | "drop";
  severity: "moderate" | "severe";
}

function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const sq = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  return Math.sqrt(sq / (values.length - 1));
}

function fillSeries(rows: { d: string; v: number }[], days = 30): { d: string; v: number }[] {
  const map = new Map(rows.map(r => [new Date(r.d).toISOString().slice(0, 10), Number(r.v) || 0]));
  const out: { d: string; v: number }[] = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ d: key, v: map.get(key) || 0 });
  }
  return out;
}

function checkAnomaly(metric: string, key: string, series: { d: string; v: number }[]): Anomaly[] {
  if (series.length < 8) return []; // need a meaningful baseline
  const out: Anomaly[] = [];
  // Inspect today (last) and yesterday (-2) against trailing 28 days excluding the inspected day.
  for (const offset of [1, 2]) {
    const idx = series.length - offset;
    if (idx < 7) continue;
    const point = series[idx];
    const baseline = series.slice(Math.max(0, idx - 28), idx).map(s => s.v);
    if (baseline.length < 7) continue;
    const avg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const sd = stddev(baseline, avg);
    if (sd === 0 && avg === 0) continue;
    // Use a small floor to avoid divide-by-near-zero noise on flat metrics
    const denom = Math.max(sd, Math.max(1, avg * 0.1));
    const z = (point.v - avg) / denom;
    const absZ = Math.abs(z);
    if (absZ < 2) continue;
    out.push({
      metric, key, date: point.d, value: point.v,
      baseline_avg: Math.round(avg * 100) / 100,
      baseline_stddev: Math.round(sd * 100) / 100,
      z_score: Math.round(z * 100) / 100,
      pct_vs_avg: avg > 0 ? Math.round(((point.v - avg) / avg) * 1000) / 10 : 0,
      direction: z > 0 ? "spike" : "drop",
      severity: absZ >= 3 ? "severe" : "moderate",
    });
  }
  return out;
}

function detectAnomalies(input: {
  revenue_cents: { d: string; v: number }[];
  signups: { d: string; v: number }[];
  active_users: { d: string; v: number }[];
  generations: { d: string; v: number }[];
}): { items: Anomaly[]; summary: string } {
  const items = [
    ...checkAnomaly("Daily revenue", "revenue_cents", fillSeries(input.revenue_cents)),
    ...checkAnomaly("New signups", "signups", fillSeries(input.signups)),
    ...checkAnomaly("Daily active users", "active_users", fillSeries(input.active_users)),
    ...checkAnomaly("Generations", "generations", fillSeries(input.generations)),
  ];
  // Sort by severity then |z|
  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "severe" ? -1 : 1;
    return Math.abs(b.z_score) - Math.abs(a.z_score);
  });
  const summary = items.length === 0
    ? "No statistical anomalies detected in the last 30 days."
    : `${items.length} anomal${items.length === 1 ? "y" : "ies"} detected (${items.filter(i => i.severity === "severe").length} severe).`;
  return { items, summary };
}

function buildPrompt(stats: any): string {
  const anomalyCount = stats.anomalies?.items?.length || 0;
  const severeCount = (stats.anomalies?.items || []).filter((a: any) => a.severity === "severe").length;

  return `You are a no-nonsense business analyst for a cyberpunk AI image/video generation platform called GLTCH.
The owner just opened the admin dashboard. Write a tight executive summary in **markdown** with these sections in order:

1. **TL;DR** — 2 sentences max, headline numbers + the single most important signal (lead with anomalies if any are severe).
2. **🚨 Anomalies** — REQUIRED if anomalies.items is non-empty. For each item, one bullet: emoji (📈 spike / 📉 drop, 🔴 severe / 🟡 moderate), metric name, the value, % vs baseline, and a one-line plausible cause hypothesis. If empty, write "No statistical anomalies detected — metrics are within normal range." and skip the bullets.
3. **Revenue & monetization** — today / week / month, paying users, sub vs pack mix, ARPU if useful.
4. **Growth & retention** — signups vs DAU/WAU/MAU, verified rate, churn signals (cancelling subs).
5. **Creator economy** — total unlocks, top earners, anything unusual.
6. **Generation usage & costs** — volume, top modes, gross margin estimate (revenue vs api cost) when data exists.
7. **Recommended actions** — 3-5 specific, concrete, prioritized actions. **Each anomaly in section 2 MUST map to at least one action here** (e.g. "Investigate the revenue drop on YYYY-MM-DD — check Stripe webhook log"). No fluff, no generic advice.

Rules:
- Anomaly detection used z-score vs trailing 28d baseline. |z|≥2 = moderate, |z|≥3 = severe. Trust these flags.
- Use cents → dollars ($X.XX) for revenue. Format big numbers with commas.
- Skip metrics that are zero or missing rather than padding.
- Keep total length under ~450 words.
- Currently flagged: ${anomalyCount} anomal${anomalyCount === 1 ? "y" : "ies"}${severeCount ? `, ${severeCount} SEVERE` : ""}.

Stats JSON:
\`\`\`json
${JSON.stringify(stats, null, 2)}
\`\`\``;
}

async function readCache(sql: ReturnType<typeof getDb>): Promise<any | null> {
  try {
    const rows = await sql`SELECT value FROM app_config WHERE key = ${CACHE_KEY}`;
    const row = rows[0] as { value: any } | undefined;
    if (!row?.value) return null;
    return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  } catch { return null; }
}

async function writeCache(sql: ReturnType<typeof getDb>, payload: any) {
  try {
    const json = JSON.stringify(payload);
    await sql`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (${CACHE_KEY}, ${json}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  } catch (e) {
    console.warn("[admin/ai-summary] cache write failed:", (e as Error).message);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!isAdmin(req)) return res.status(403).json({ error: "Access denied" });

  const sql = getDb();

  if (req.method === "GET") {
    const cached = await readCache(sql);
    if (!cached) return res.status(200).json({ cached: null });
    const ageMs = Date.now() - new Date(cached.generated_at || 0).getTime();
    return res.status(200).json({
      cached: {
        ...cached,
        age_ms: ageMs,
        is_fresh: ageMs < CACHE_TTL_MS,
      },
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Honor cache unless ?force=1
  const force = req.query.force === "1" || (req.body && req.body.force === true);
  if (!force) {
    const cached = await readCache(sql);
    if (cached) {
      const ageMs = Date.now() - new Date(cached.generated_at || 0).getTime();
      if (ageMs < CACHE_TTL_MS) {
        return res.status(200).json({ cached: { ...cached, age_ms: ageMs, is_fresh: true } });
      }
    }
  }

  const ai = resolveAiConfig();
  if (!ai) {
    return res.status(503).json({
      code: "AI_KEY_MISSING",
      error:
        "No AI key configured. Set DEEPSEEK_API_KEY (recommended) or LOVABLE_API_KEY in Vercel → Settings → Environment Variables, then redeploy.",
    });
  }

  let stats: any;
  try {
    stats = await aggregateStats(sql);
  } catch (e: any) {
    return res.status(500).json({ error: `Stats aggregation failed: ${e.message}` });
  }

  const prompt = buildPrompt(stats);

  let aiResp: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ai.apiKey}`,
    };
    if (ai.provider === "lovable") {
      headers["Lovable-API-Key"] = ai.apiKey;
      headers["X-Lovable-AIG-SDK"] = "vercel-ai-sdk";
    }
    aiResp = await fetch(ai.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: ai.model,
        stream: true,
        messages: [
          { role: "system", content: "You are a precise business analyst. Output clean markdown only." },
          { role: "user", content: prompt },
        ],
        ...(ai.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
      }),
    });
  } catch (e: any) {
    return res.status(502).json({ error: `AI gateway unreachable: ${e.message}` });
  }

  if (!aiResp.ok || !aiResp.body) {
    if (aiResp.status === 429) return res.status(429).json({ error: "Rate limited — try again shortly." });
    if (aiResp.status === 402) return res.status(402).json({ error: "AI credits exhausted." });
    const t = await aiResp.text().catch(() => "");
    return res.status(500).json({ error: `AI gateway error ${aiResp.status}: ${t.slice(0, 200)}` });
  }

  // Stream raw SSE through; emit a final "stats" SSE event then [DONE]
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  // Send stats first as a custom SSE event so the client can render the data grid immediately.
  res.write(`event: stats\ndata: ${JSON.stringify(stats)}\n\n`);

  const reader = aiResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Forward chunk through, but also parse to assemble final markdown for caching
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.startsWith("data: ")) {
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) assembled += delta;
          } catch { /* partial */ }
        }
        // Forward exact line + newline so the client can parse normally
        res.write(line + "\n");
      }
    }
    if (buffer) res.write(buffer);
  } catch (e: any) {
    res.write(`\nevent: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
  }

  res.write("\ndata: [DONE]\n\n");
  res.end();

  // Persist cache (fire-and-forget after end is fine on Vercel — but do it before for safety)
  await writeCache(sql, { ...stats, summary_markdown: assembled, generated_at: new Date().toISOString(), model: ai.model, provider: ai.provider });
}

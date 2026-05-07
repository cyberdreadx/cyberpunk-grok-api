/**
 * AI-generated executive summary for admins.
 * Streams from /api/admin/ai-summary, displays markdown + raw stats grid.
 */
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles, RefreshCw, Loader2, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, apiUrl, getAuthToken } from "@/lib/api";

interface AnomalyItem {
  metric: string;
  key: string;
  date: string;
  value: number;
  baseline_avg: number;
  baseline_stddev: number;
  z_score: number;
  pct_vs_avg: number;
  direction: "spike" | "drop";
  severity: "moderate" | "severe";
}

interface CachedSummary {
  generated_at: string;
  age_ms?: number;
  is_fresh?: boolean;
  model?: string;
  summary_markdown?: string;
  revenue?: any;
  users?: any;
  active?: any;
  usage?: any;
  topModes?: { mode: string; n: number; credits: number }[];
  costs?: any;
  creator?: { totals?: any; top?: { name: string; credits_earned: number; cents_earned: number; unlocks: number }[] };
  creditPool?: any;
  anomalies?: { items: AnomalyItem[]; summary: string };
}

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function $(cents?: number): string {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function num(n?: number): string {
  return (n || 0).toLocaleString();
}

export default function AdminInsightsPanel() {
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CachedSummary | null>(null);
  const [liveMarkdown, setLiveMarkdown] = useState<string>("");

  // Initial: load cached summary
  useEffect(() => {
    let alive = true;
    apiFetch<{ cached: CachedSummary | null }>("/admin/ai-summary")
      .then((r) => { if (alive) setData(r.cached); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const generate = useCallback(async (force: boolean) => {
    setError(null);
    setStreaming(true);
    setLiveMarkdown("");

    try {
      const url = apiUrl(`/admin/ai-summary${force ? "?force=1" : ""}`);
      const token = getAuthToken();
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ force }),
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        let msg = `HTTP ${resp.status}`;
        try { msg = JSON.parse(txt).error || msg; } catch { if (txt) msg = txt.slice(0, 200); }
        throw new Error(msg);
      }

      const ctype = resp.headers.get("content-type") || "";
      // Server returns JSON when serving from cache
      if (ctype.includes("application/json")) {
        const j = await resp.json();
        if (j.cached) setData(j.cached);
        return;
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";
      let statsBlob: any = null;
      let currentEvent: string | null = null;

      let done = false;
      while (!done) {
        const { done: d, value } = await reader.read();
        done = d;
        if (value) buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);

          if (line === "") { currentEvent = null; continue; }
          if (line.startsWith(":")) continue;
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
          if (!line.startsWith("data: ")) continue;

          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }

          if (currentEvent === "stats") {
            try { statsBlob = JSON.parse(payload); } catch { /* ignore */ }
            continue;
          }
          if (currentEvent === "error") {
            try { throw new Error(JSON.parse(payload).error || "stream error"); } catch (e) { throw e; }
          }

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assembled += delta;
              setLiveMarkdown(assembled);
            }
          } catch { /* partial JSON across chunks — re-buffer */
            buffer = "data: " + payload + "\n" + buffer;
            break;
          }
        }
      }

      // Final state
      if (statsBlob) {
        setData({
          ...statsBlob,
          summary_markdown: assembled,
          generated_at: new Date().toISOString(),
          age_ms: 0,
          is_fresh: true,
        });
      } else {
        setData((prev) => ({ ...(prev || {} as any), summary_markdown: assembled, generated_at: new Date().toISOString(), age_ms: 0, is_fresh: true }));
      }
      setLiveMarkdown("");
    } catch (e: any) {
      setError(e.message || "Failed to generate summary");
    } finally {
      setStreaming(false);
    }
  }, []);

  const showMarkdown = streaming ? liveMarkdown : (data?.summary_markdown || "");
  const stale = data && data.age_ms != null && !data.is_fresh;

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="border border-primary/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="font-mono-share text-sm tracking-wider text-primary">AI_INSIGHTS</h2>
            {data?.generated_at && (
              <span className="font-mono-share text-[10px] text-muted-foreground/70 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {fmtAge(data.age_ms ?? (Date.now() - new Date(data.generated_at).getTime()))}
                {stale && <span className="text-yellow-500/80 ml-1">(stale)</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data?.summary_markdown && (
              <Button
                size="sm"
                variant="outline"
                disabled={streaming}
                onClick={() => generate(true)}
                className="font-mono-share text-[11px]"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${streaming ? "animate-spin" : ""}`} />
                REGENERATE
              </Button>
            )}
            {!data?.summary_markdown && (
              <Button
                size="sm"
                disabled={streaming || loading}
                onClick={() => generate(false)}
                className="font-mono-share text-[11px]"
              >
                {streaming ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                GENERATE SUMMARY
              </Button>
            )}
          </div>
        </div>

        <p className="font-mono-share text-[10px] text-muted-foreground/60 leading-relaxed">
          AI-generated executive summary covering revenue, growth, creator economy, and generation costs.
          Cached for 1 hour — click REGENERATE to force a fresh pass.
        </p>

        {error && (
          <div className="border border-destructive/40 bg-destructive/10 rounded p-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="font-mono-share text-[11px] text-destructive">{error}</p>
          </div>
        )}
      </section>

      {/* Anomaly banner */}
      {data?.anomalies && data.anomalies.items.length > 0 && (
        <section className={`border rounded-lg p-3 sm:p-4 backdrop-blur-sm ${
          data.anomalies.items.some(a => a.severity === "severe")
            ? "border-destructive/50 bg-destructive/5"
            : "border-yellow-500/40 bg-yellow-500/5"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className={`w-4 h-4 ${data.anomalies.items.some(a => a.severity === "severe") ? "text-destructive" : "text-yellow-500"}`} />
            <h3 className="font-mono-share text-xs tracking-wider text-foreground">
              ANOMALIES_DETECTED <span className="text-muted-foreground/70">({data.anomalies.items.length})</span>
            </h3>
          </div>
          <div className="space-y-1.5">
            {data.anomalies.items.slice(0, 6).map((a, i) => (
              <div key={i} className="flex items-start gap-2 font-mono-share text-[11px]">
                <span className="shrink-0">
                  {a.severity === "severe" ? "🔴" : "🟡"} {a.direction === "spike" ? "📈" : "📉"}
                </span>
                <span className="text-foreground/90">
                  <span className="font-semibold">{a.metric}</span> on {a.date}:{" "}
                  <span className={a.direction === "spike" ? "text-secondary" : "text-destructive"}>
                    {a.key === "revenue_cents" ? `$${(a.value / 100).toFixed(2)}` : a.value.toLocaleString()}
                  </span>
                  {" "}vs avg {a.key === "revenue_cents" ? `$${(a.baseline_avg / 100).toFixed(2)}` : a.baseline_avg.toLocaleString()}
                  {" "}<span className="text-muted-foreground/70">({a.pct_vs_avg > 0 ? "+" : ""}{a.pct_vs_avg}%, z={a.z_score})</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Markdown summary */}
      {(showMarkdown || streaming || loading) && (
        <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-4 sm:p-5">
          {loading && !showMarkdown ? (
            <div className="flex items-center gap-2 text-muted-foreground/70 font-mono-share text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading cached summary…
            </div>
          ) : showMarkdown ? (
            <div className="prose prose-sm prose-invert max-w-none
              prose-headings:font-mono-share prose-headings:text-primary prose-headings:tracking-wider
              prose-h1:text-base prose-h2:text-sm prose-h3:text-xs
              prose-strong:text-foreground prose-strong:font-semibold
              prose-a:text-secondary
              prose-ul:my-2 prose-li:my-0.5
              prose-code:text-secondary prose-code:bg-muted/30 prose-code:px-1 prose-code:rounded">
              <ReactMarkdown>{showMarkdown}</ReactMarkdown>
              {streaming && (
                <span className="inline-block w-2 h-4 bg-primary/80 animate-pulse ml-0.5 align-middle" aria-hidden />
              )}
            </div>
          ) : null}
        </section>
      )}

      {/* Raw stats grid */}
      {data && (data.revenue || data.users) && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <Stat label="REV TODAY" value={$(data.revenue?.today_cents)} />
          <Stat label="REV THIS WEEK" value={$(data.revenue?.week_cents)} />
          <Stat label="REV THIS MONTH" value={$(data.revenue?.month_cents)} />
          <Stat label="REV ALL-TIME" value={$(data.revenue?.total_cents)} />

          <Stat label="USERS" value={num(data.users?.total)} sub={`${num(data.users?.verified)} verified`} />
          <Stat label="NEW TODAY" value={num(data.users?.new_today)} sub={`${num(data.users?.new_week)} this week`} />
          <Stat label="SUBSCRIBERS" value={num(data.users?.subscribers)} sub={`${num(data.users?.cancelling)} cancelling`} />
          <Stat label="DAU / WAU / MAU" value={`${num(data.active?.dau)} / ${num(data.active?.wau)} / ${num(data.active?.mau)}`} />

          <Stat label="GENS TODAY" value={num(data.usage?.gens_today)} />
          <Stat label="GENS THIS MONTH" value={num(data.usage?.gens_month)} />
          <Stat label="CREDITS / MONTH" value={num(data.usage?.credits_month)} />
          <Stat label="API COST / MONTH" value={$(Number(data.costs?.month_cost_cents) || 0)} />

          <Stat label="CREATOR UNLOCKS" value={num(data.creator?.totals?.total_unlocks)} />
          <Stat label="UNLOCK CREDITS" value={num(data.creator?.totals?.total_credits_unlocked)} />
          <Stat label="UNLOCK CASH" value={$(data.creator?.totals?.total_cents_unlocked)} />
          <Stat label="OUTSTANDING CREDITS" value={num((data.creditPool?.sub_outstanding || 0) + (data.creditPool?.pack_outstanding || 0))} />
        </section>
      )}

      {/* Top modes & creators */}
      {data?.topModes && data.topModes.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3">
            <h3 className="font-mono-share text-[11px] tracking-wider text-muted-foreground mb-2">TOP MODES (30D)</h3>
            <div className="space-y-1">
              {data.topModes.map((m) => (
                <div key={m.mode} className="flex items-center justify-between font-mono-share text-[11px]">
                  <span className="text-foreground/90 truncate">{m.mode}</span>
                  <span className="text-muted-foreground">{num(m.n)} • {num(m.credits)}c</span>
                </div>
              ))}
            </div>
          </section>

          {data.creator?.top && data.creator.top.length > 0 && (
            <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3">
              <h3 className="font-mono-share text-[11px] tracking-wider text-muted-foreground mb-2">TOP CREATORS</h3>
              <div className="space-y-1">
                {data.creator.top.map((c, i) => (
                  <div key={i} className="flex items-center justify-between font-mono-share text-[11px]">
                    <span className="text-foreground/90 truncate">{c.name}</span>
                    <span className="text-muted-foreground">{$(c.cents_earned)} • {num(c.credits_earned)}c</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!loading && !data && !streaming && !error && (
        <div className="text-center py-8 text-muted-foreground/60 font-mono-share text-xs">
          No summary yet. Click GENERATE SUMMARY to create one.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3">
      <div className="font-mono-share text-[10px] tracking-wider text-muted-foreground/70 mb-1">{label}</div>
      <div className="font-mono-share text-base text-foreground tabular-nums">{value}</div>
      {sub && <div className="font-mono-share text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

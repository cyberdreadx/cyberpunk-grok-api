/**
 * Admin → Media Errors panel.
 *
 * Pulls aggregated client-side media-load failures from /api/media-errors
 * (last N days) so we can see which CDN hosts / extensions / specific URLs
 * are 404ing on real users. Useful for spotting rotated Vercel Blob stores,
 * expired signed URLs, codec issues on iOS, etc.
 */

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Loader2, RefreshCw, AlertTriangle, ImageOff, FileVideo, Globe } from "lucide-react";

interface HostRow { host: string; kind: string; count: number }
interface ExtRow { ext: string; kind: string; count: number }
interface UrlRow { url: string; host: string; ext: string; kind: string; count: number; last_seen: string }
interface RecentRow { id: number; url: string; host: string; ext: string; kind: string; source: string; created_at: string }

interface Payload {
  total: number;
  days: number;
  byHost: HostRow[];
  byExt: ExtRow[];
  topUrls: UrlRow[];
  recent: RecentRow[];
  warning?: string;
}

const RANGES = [1, 7, 30] as const;

const fmtTime = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const KindBadge: React.FC<{ kind: string }> = ({ kind }) => (
  <span className={`inline-flex items-center gap-1 font-mono-share text-[9px] px-1.5 py-0.5 rounded border ${
    kind === "video"
      ? "border-secondary/40 text-secondary bg-secondary/10"
      : "border-primary/40 text-primary bg-primary/10"
  }`}>
    {kind === "video" ? <FileVideo className="w-2.5 h-2.5" /> : <ImageOff className="w-2.5 h-2.5" />}
    {kind.toUpperCase()}
  </span>
);

const MediaErrorsPanel: React.FC = () => {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number>(7);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await apiFetch<Payload>(`/media-errors?days=${days}`);
      setData(res);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          MEDIA_ERRORS
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border border-border/40 rounded-md p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={`font-mono-share text-[10px] px-2 py-1 rounded transition-colors ${
                  days === r ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >{r}d</button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="font-mono-share text-[10px] px-2 py-1 rounded border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 inline-flex items-center gap-1"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            REFRESH
          </button>
        </div>
      </div>

      {err && (
        <div className="border border-destructive/40 bg-destructive/10 rounded p-3 font-mono-share text-[11px] text-destructive">
          {err}
        </div>
      )}
      {data?.warning && (
        <div className="border border-amber-400/30 bg-amber-400/10 rounded p-3 font-mono-share text-[11px] text-amber-300">
          {data.warning}
        </div>
      )}

      {/* Total card */}
      <div className="border border-border/30 rounded-lg bg-card/40 p-3">
        <div className="font-mono-share text-[9px] text-muted-foreground tracking-widest">TOTAL_FAILURES</div>
        <div className="font-orbitron text-2xl text-primary mt-1">{data?.total ?? "—"}</div>
        <div className="font-mono-share text-[10px] text-muted-foreground/70 mt-0.5">over last {days} day{days === 1 ? "" : "s"}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* By host */}
        <div className="border border-border/30 rounded-lg bg-card/40 p-3 min-w-0">
          <div className="font-mono-share text-[10px] text-muted-foreground/80 mb-2 flex items-center gap-1">
            <Globe className="w-3 h-3" /> BY_HOST
          </div>
          {(!data || data.byHost.length === 0) ? (
            <div className="font-mono-share text-[10px] text-muted-foreground/60">No data</div>
          ) : (
            <ul className="space-y-1">
              {data.byHost.map((r, i) => (
                <li key={`${r.host}-${r.kind}-${i}`} className="flex items-center justify-between gap-2 font-mono-share text-[11px]">
                  <span className="flex items-center gap-2 min-w-0">
                    <KindBadge kind={r.kind} />
                    <span className="text-foreground truncate">{r.host}</span>
                  </span>
                  <span className="text-primary tabular-nums shrink-0">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* By ext */}
        <div className="border border-border/30 rounded-lg bg-card/40 p-3 min-w-0">
          <div className="font-mono-share text-[10px] text-muted-foreground/80 mb-2">BY_EXTENSION</div>
          {(!data || data.byExt.length === 0) ? (
            <div className="font-mono-share text-[10px] text-muted-foreground/60">No data</div>
          ) : (
            <ul className="space-y-1">
              {data.byExt.map((r, i) => (
                <li key={`${r.ext}-${r.kind}-${i}`} className="flex items-center justify-between gap-2 font-mono-share text-[11px]">
                  <span className="flex items-center gap-2 min-w-0">
                    <KindBadge kind={r.kind} />
                    <span className="text-foreground">.{r.ext || "(none)"}</span>
                  </span>
                  <span className="text-primary tabular-nums shrink-0">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Top URLs */}
      <div className="border border-border/30 rounded-lg bg-card/40 p-3 min-w-0 overflow-hidden">
        <div className="font-mono-share text-[10px] text-muted-foreground/80 mb-2">TOP_BROKEN_URLS</div>
        {(!data || data.topUrls.length === 0) ? (
          <div className="font-mono-share text-[10px] text-muted-foreground/60">No data</div>
        ) : (
          <ul className="space-y-2">
            {data.topUrls.map((r) => (
              <li key={r.url} className="flex items-start justify-between gap-3 border-b border-border/20 pb-2 last:border-b-0 last:pb-0">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <KindBadge kind={r.kind} />
                    <span className="font-mono-share text-[10px] text-muted-foreground">{r.host}</span>
                    <span className="font-mono-share text-[10px] text-muted-foreground/60">last {fmtTime(r.last_seen)}</span>
                  </div>
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                     className="block font-mono-share text-[10px] text-primary/80 hover:text-primary break-all">
                    {truncate(r.url, 140)}
                  </a>
                </div>
                <span className="font-mono-share text-[11px] text-primary tabular-nums shrink-0 mt-0.5">×{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent */}
      <details className="border border-border/30 rounded-lg bg-card/40 p-3">
        <summary className="cursor-pointer font-mono-share text-[10px] text-muted-foreground/80">
          RECENT_50 ({data?.recent?.length || 0})
        </summary>
        <ul className="mt-2 space-y-1.5 max-h-96 overflow-y-auto">
          {data?.recent.map((r) => (
            <li key={r.id} className="font-mono-share text-[10px] text-muted-foreground flex items-start gap-2">
              <span className="text-muted-foreground/60 shrink-0">{fmtTime(r.created_at)}</span>
              <KindBadge kind={r.kind} />
              <span className="text-foreground/80 truncate">{r.host}</span>
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                 className="text-primary/70 hover:text-primary truncate min-w-0">{truncate(r.url, 80)}</a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};

export default MediaErrorsPanel;

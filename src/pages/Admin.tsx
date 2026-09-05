import React, { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  DollarSign,
  Zap,
  TrendingUp,
  CreditCard,
  Activity,
  ArrowLeft,
  RefreshCw,
  Crown,
  Server,
  Loader2,
  ShieldAlert,
  Receipt,
  ShieldX,
  Ban,
  Flame,
  Share2,
  Gift,
  BarChart3,
  Eye,
  Trash2,
  Cpu,
  Mail,
  AlertTriangle,
  Key,
  Send,
  Edit,
  ChevronDown,
  ChevronUp,
  Shield,
  Sparkles,
  ImageOff,
  Tractor,
  Award,
  Landmark,
  Undo2,
} from "lucide-react";
import AdminInsightsPanel from "@/components/AdminInsightsPanel";
import AdminFinancePanel from "@/components/AdminFinancePanel";
import AdminAmbassadorPanel from "@/components/AdminAmbassadorPanel";
import RangeControl, { loadRange, rangeLabel, type ChartRange } from "@/components/admin/RangeControl";
import AdminChatModerationPanel from "@/components/AdminChatModerationPanel";
import PurgeLogPanel from "@/components/PurgeLogPanel";
import MediaErrorsPanel from "@/components/MediaErrorsPanel";
import LegacySubReconcilePanel from "@/components/LegacySubReconcilePanel";
import AdminFarmersPanel from "@/components/AdminFarmersPanel";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Brush,
} from "recharts";
import { Button } from "@/components/ui/button";
import { apiFetch, hasAuthToken } from "@/lib/api";

// Admin check is now server-side via /api/auth/me is_admin flag

function fmt$(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Axis label matched to the bucket the server actually used. A month bucket
 * rendered as "Aug 1" reads like a single day and drops the year, which
 * matters now that the range can span more than a year.
 */
function fmtBucket(d: string, bucket: string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  if (bucket === "month") {
    return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  const label = dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return bucket === "week" ? `w/${label}` : label;
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "--";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "--";
  return `${(v * 100).toFixed(digits)}%`;
}

/** Distinct hues for stacked usage series, cycled by index. */
const SERIES_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(280 70% 60%)",
  "hsl(35 90% 55%)",
  "hsl(150 60% 45%)",
  "hsl(200 80% 55%)",
  "hsl(0 70% 55%)",
  "hsl(60 70% 50%)",
];

// ── Types ──

interface ModerationOffender {
  email: string; block_count: number; credits_burned: number; last_block: string;
}
interface ModerationStats {
  total_blocks: number; blocks_window: number; blocks_30d: number; blocks_today: number;
  total_credits_burned: number; credits_burned_window: number; credits_burned_30d: number;
  wasted_cost_total_cents: number; wasted_cost_window_cents: number;
  offenders: ModerationOffender[];
}
/** Per-vendor cost for the selected window. Keys: runpod | xai | seedance | none. */
interface ProviderCost {
  jobs: number; refundedJobs: number; netCredits: number;
  trackedCents: number; trackedRows: number; blendedCents: number; execMs: number;
}
interface Overview {
  range: { days: number | null; bucket: string; label: string };
  users: { total_users: number; verified_users: number; active_subscribers: number; cancelling_subscribers: number; new_today: number; new_this_week: number };
  revenue: {
    total_revenue_cents: number; revenue_window_cents: number; revenue_30d_cents: number;
    revenue_7d_cents: number; revenue_today_cents: number; total_transactions: number;
    pack_purchases: number; sub_renewals: number; grant_rows: number; granted_credits: number; paying_users: number;
  };
  usage: {
    total_credits_used: number; credits_window: number; credits_30d: number; credits_today: number;
    total_generations: number; generations_window: number; generations_today: number;
    refunded_generations: number; refunded_credits: number; refunded_window: number; active_users_window: number;
  };
  creditPool: { total_sub_credits_outstanding: number; total_pack_credits_outstanding: number; total_daily_credits_outstanding: number };
  cost: {
    byProvider: Record<string, ProviderCost>;
    blendedCents: number; trackedCents: number; trackedRows: number; jobRows: number;
    coverage: number; runpodCentsPerSec: number;
  };
  margin: {
    revenueCents: number; costCents: number; grossCents: number; marginPct: number;
    revenuePerCredit: number; costPerCredit: number;
  };
  moderation: ModerationStats;
}

interface RevenueRow {
  day: string; revenue_cents: number; tx_count: number; packs: number; subs: number;
  pack_cents: number; sub_cents: number; buyers: number; cumulative_cents: number;
}
interface UserRow { day: string; new_users: number; verified: number; cumulative: number }
interface UsageRow { day: string; mode: string; count: number; refunded: number; credits: number }
interface Transaction {
  created_at: string; email: string; type: string; package: string; credits: number;
  amount_cents: number; gateway: string; payment_method: string | null;
}
interface TopUser {
  email: string; subscription_tier: string | null; subscription_cancel_at: string | null; sub_credits: number; pack_credits: number;
  created_at: string; total_spent_cents: number; total_generations: number; total_credits_used: number; last_generation: string | null;
  purchases: number; cost_cents: number; margin_cents: number;
}

// ── Shared Components ──

function KpiCard({ icon, label, value, sub, accent = "primary" }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; accent?: "primary" | "secondary" | "destructive";
}) {
  const chipMap = {
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/10 text-secondary",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <div className="holo-card p-3 sm:p-4 space-y-1.5 min-w-0 overflow-hidden" data-numeric>
      <div className="flex items-center gap-2 text-muted-foreground/70">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${chipMap[accent]}`}>{icon}</span>
        <span className="font-mono-share text-[10px] tracking-wider uppercase truncate">{label}</span>
      </div>
      <div className="font-orbitron text-xl sm:text-2xl font-bold tracking-wide truncate">{value}</div>
      {sub && <div className="font-mono-share text-[10px] text-muted-foreground/60 truncate">{sub}</div>}
    </div>
  );
}

/**
 * Values whose dataKey ends in `_cents` are money. The old rule guessed from
 * the series *name* containing "revenue", so a "Packs" bar rendered as a raw
 * cent count.
 */
function CyberTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value !== null && p.value !== undefined);
  if (!rows.length) return null;
  const total = rows.reduce((a: number, p: any) => a + (typeof p.value === "number" ? p.value : 0), 0);
  const isMoney = String(rows[0]?.dataKey ?? "").endsWith("_cents");
  return (
    <div className="bg-card/95 border border-border/50 rounded px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="font-mono-share text-[10px] text-primary/70 mb-1">{label}</p>
      {rows.map((p: any, i: number) => (
        <p key={i} className="font-mono-share text-xs" style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" && String(p.dataKey ?? "").endsWith("_cents")
            ? fmt$(p.value)
            : typeof p.value === "number" ? p.value.toLocaleString() : p.value}
        </p>
      ))}
      {rows.length > 1 && (
        <p className="font-mono-share text-[10px] text-muted-foreground/70 mt-1 pt-1 border-t border-border/30">
          total: {isMoney ? fmt$(total) : total.toLocaleString()}
        </p>
      )}
    </div>
  );
}

/** Small on/off pill for chart display options. */
function ChartToggle({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-2 py-1 font-mono-share text-[10px] tracking-wider rounded border transition-colors ${
        active
          ? "bg-primary/20 text-primary border-primary/40"
          : "text-muted-foreground/60 border-border/30 hover:text-foreground hover:bg-primary/5"
      }`}
    >
      {children}
    </button>
  );
}

// ── Tab Definitions ──

type TabId = "overview" | "insights" | "revenue" | "finance" | "users" | "usage" | "moderation" | "farmers" | "referrals" | "ambassadors" | "payouts" | "emails" | "api" | "system" | "flash-sales" | "media-errors" | "purges" | "legacy-subs";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "OVERVIEW", icon: <Eye className="w-3.5 h-3.5" /> },
  { id: "insights", label: "INSIGHTS", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: "revenue", label: "REVENUE", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { id: "finance", label: "FINANCE", icon: <Landmark className="w-3.5 h-3.5" /> },
  { id: "users", label: "USERS", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "usage", label: "USAGE", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "moderation", label: "DEFENSE", icon: <ShieldX className="w-3.5 h-3.5" /> },
  { id: "farmers", label: "FARMERS", icon: <Tractor className="w-3.5 h-3.5" /> },
  { id: "referrals", label: "REFERRALS", icon: <Share2 className="w-3.5 h-3.5" /> },
  { id: "ambassadors", label: "AMBASSADORS", icon: <Award className="w-3.5 h-3.5" /> },
  { id: "payouts", label: "PAYOUTS", icon: <CreditCard className="w-3.5 h-3.5" /> },
  { id: "legacy-subs", label: "LEGACY SUBS", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  { id: "flash-sales", label: "FLASH SALES", icon: <Flame className="w-3.5 h-3.5" /> },
  { id: "emails", label: "EMAILS", icon: <Mail className="w-3.5 h-3.5" /> },
  { id: "api", label: "API", icon: <Key className="w-3.5 h-3.5" /> },
  { id: "system", label: "SYSTEM", icon: <Server className="w-3.5 h-3.5" /> },
  { id: "media-errors", label: "MEDIA ERR", icon: <ImageOff className="w-3.5 h-3.5" /> },
  { id: "purges", label: "PURGES", icon: <Trash2 className="w-3.5 h-3.5" /> },
];

// Two-tier navigation: 15 flat tabs grouped into 5 clusters so the bar
// doesn't require horizontal scrolling to find anything.
const TAB_GROUPS: { id: string; label: string; tabs: TabId[] }[] = [
  { id: "pulse", label: "PULSE", tabs: ["overview", "insights"] },
  { id: "money", label: "MONEY", tabs: ["revenue", "finance", "payouts", "flash-sales", "legacy-subs"] },
  { id: "people", label: "PEOPLE", tabs: ["users", "referrals", "ambassadors", "emails"] },
  { id: "ops", label: "OPS", tabs: ["usage", "system", "media-errors", "purges"] },
  { id: "defense", label: "DEFENSE", tabs: ["moderation", "farmers", "api"] },
];

const tabById = (id: TabId) => TABS.find((t) => t.id === id)!;
const groupOfTab = (id: TabId) => TAB_GROUPS.find((g) => g.tabs.includes(id))!;

// ── RunPod Worker Status Panel ──

function WorkerStatusPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  const fetchWorkers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/comfyui", { method: "POST", body: { action: "workers" } });
      setData(res);
    } catch (err: any) {
      setData({ error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePurge = useCallback(async () => {
    if (!confirm("Purge ALL queued RunPod jobs? Running jobs will continue.")) return;
    setPurging(true);
    setPurgeResult(null);
    try {
      const res = await apiFetch("/comfyui", { method: "POST", body: { action: "purge" } });
      setPurgeResult(res.status === "purged" ? "Queue purged successfully" : JSON.stringify(res));
      fetchWorkers();
    } catch (err: any) {
      setPurgeResult(`Failed: ${err.message}`);
    } finally {
      setPurging(false);
    }
  }, [fetchWorkers]);

  useEffect(() => { fetchWorkers(); }, [fetchWorkers]);

  return (
    <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">RUNPOD_WORKERS</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePurge} disabled={purging}
            className="font-mono-share text-xs gap-1.5 border-destructive/30 hover:bg-destructive/10 text-destructive">
            {purging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            PURGE_QUEUE
          </Button>
          <Button variant="outline" size="sm" onClick={fetchWorkers} disabled={loading}
            className="font-mono-share text-xs gap-1.5 border-cyan-500/30 hover:bg-cyan-500/10">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            REFRESH
          </Button>
        </div>
      </div>

      {purgeResult && (
        <div className={`font-mono-share text-[10px] px-2 py-1 rounded ${purgeResult.startsWith("Failed") ? "bg-destructive/10 text-destructive" : "bg-green-500/10 text-green-400"}`}>
          {purgeResult}
        </div>
      )}

      {data?.error && (
        <div className="font-mono-share text-xs text-destructive">{data.error}</div>
      )}

      {data?.endpoints && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.endpoints.map((ep: any) => {
            const w = ep.workers || {};
            const j = ep.jobs || {};
            const totalWorkers = (w.idle || 0) + (w.running || 0) + (w.initializing || 0) + (w.ready || 0) + (w.throttled || 0);
            const healthy = !ep.error;
            return (
              <div key={ep.endpoint} className={`border rounded-lg p-3 space-y-2 ${healthy ? "border-cyan-500/20 bg-cyan-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-orbitron text-[9px] tracking-wider text-primary">{ep.name}</span>
                  <span className={`font-mono-share text-[8px] px-1.5 py-0.5 rounded ${healthy ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {healthy ? "ONLINE" : "ERROR"}
                  </span>
                </div>
                <div className="font-mono-share text-[9px] text-muted-foreground/50 truncate">{ep.endpoint}</div>

                {healthy && (
                  <>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="bg-background/30 rounded px-2 py-1">
                        <div className="font-mono-share text-[8px] text-muted-foreground/50">WORKERS</div>
                        <div className="font-orbitron text-sm text-foreground">{totalWorkers}</div>
                      </div>
                      <div className="bg-background/30 rounded px-2 py-1">
                        <div className="font-mono-share text-[8px] text-muted-foreground/50">IN_QUEUE</div>
                        <div className="font-orbitron text-sm text-yellow-400">{j.inQueue || 0}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono-share text-[9px]">
                      <span className="text-green-400">idle: {w.idle || 0}</span>
                      <span className="text-cyan-400">running: {w.running || 0}</span>
                      <span className="text-yellow-400">init: {w.initializing || 0}</span>
                      <span className="text-orange-400">throttled: {w.throttled || 0}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono-share text-[9px] text-muted-foreground/50">
                      <span>completed: {j.completed || 0}</span>
                      <span>failed: {j.failed || 0}</span>
                      <span>running: {j.inProgress || 0}</span>
                      <span>retried: {j.retried || 0}</span>
                    </div>
                  </>
                )}

                {ep.error && (
                  <div className="font-mono-share text-[9px] text-red-400 break-all">{ep.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!data && !loading && (
        <div className="font-mono-share text-xs text-muted-foreground/50 text-center py-4">
          Click REFRESH to load worker status
        </div>
      )}
    </section>
  );
}

// ── Announcement Panel ──

function AnnouncementPanel() {
  const [sending, setSending] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [progress, setProgress] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const abortRef = useRef(false);
  const [stats, setStats] = useState<{ totalVerified: number; alreadySent: number; remaining: number } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [campaign, setCampaign] = useState<"announcement" | "announcement_v47" | "announcement_v48" | "announcement_v49" | "announcement_v52" | "announcement_launch">("announcement_launch");
  const [subject, setSubject] = useState("🚀 GLTCH Runner is here — chat with AI models + video gen");
  const [showEditor, setShowEditor] = useState(false);
  const [htmlContent, setHtmlContent] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [bgRunning, setBgRunning] = useState(false);
  const [bgStartedAt, setBgStartedAt] = useState<number | null>(null);
  const [bgInitialRemaining, setBgInitialRemaining] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await apiFetch("/admin", { method: "POST", body: { action: "announcement-stats", campaign } });
      setStats(res);
      return res;
    } catch { /* ignore */ }
    finally { setStatsLoading(false); }
  }, [campaign]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Resume polling if a cron campaign was already running
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/admin", { method: "POST", body: { action: "campaign-status", campaign } });
        if (cancelled) return;
        if (res.active && res.job?.startedAt) {
          setBgRunning(true);
          setBgStartedAt(new Date(res.job.startedAt).getTime());
          if (typeof res.remaining === "number") setBgInitialRemaining(res.remaining + (res.job.totalSent ?? 0));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [campaign]);

  const CAMPAIGN_SUBJECTS: Record<string, string> = {
    announcement_launch: "🚀 GLTCH Runner is here — chat with AI models + video gen",
    announcement_v52: "⚡ GLTCHRunner v5.2 — Faster & More Reliable Than Ever",
    announcement_v49: "GLTCHRunner — Subscription Credits Fixed + Platform Update",
    announcement_v48: "⚡ GLTCH Runner v4.8 // Signal Boost",
    announcement_v47: "⚡ GLTCH Runner v4.7 // the coolest drop yet",
    announcement: "🚀 GLTCH Runner just got a massive upgrade",
  };

  // Reset custom HTML and cancel state when switching campaigns
  useEffect(() => { setHtmlContent(""); setCancelled(false); }, [campaign]);

  // Live poll while a cron campaign is running.
  useEffect(() => {
    if (!bgRunning) return;
    let cancelled = false;
    let stallCount = 0;
    let lastRemaining: number | null = null;

    const tick = async () => {
      try {
        const [statsRes, statusRes]: any[] = await Promise.all([
          fetchStats(),
          apiFetch("/admin", { method: "POST", body: { action: "campaign-status", campaign } }),
        ]);
        if (cancelled) return;
        const remaining = typeof statusRes?.remaining === "number" ? statusRes.remaining : statsRes?.remaining;
        if (typeof remaining === "number") {
          if (remaining === 0 || !statusRes?.active) {
            setBgRunning(false);
            return;
          }
          if (lastRemaining !== null && remaining === lastRemaining) {
            stallCount++;
            // Cron runs every 2 min — allow ~3 min without progress before warning stop
            if (stallCount >= 45) {
              setBgRunning(false);
              return;
            }
          } else {
            stallCount = 0;
          }
          lastRemaining = remaining;
        }
      } catch { /* ignore transient poll errors */ }
    };

    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [bgRunning, fetchStats, campaign]);

  const handleDryRun = async () => {
    setDryRunning(true);
    setResult(null);
    try {
      const res = await apiFetch("/admin", {
        method: "POST",
        body: { action: "send-announcement", dryRun: true, batchSize: 999999, offset: 0, campaign },
      });
      setResult({ dryRun: true, totalUsers: res.totalUsers, emails: res.batchEmails });
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setDryRunning(false);
    }
  };

  const handleSend = async (isResume = false) => {
    const msg = isResume
      ? "Resume sending? Already-sent users will be skipped automatically."
      : "Send the announcement email to ALL verified users? This cannot be undone.";
    if (!confirm(msg)) return;
    setSending(true);
    if (!isResume) setResult(null);
    abortRef.current = false;
    const batchSize = 25;
    let offset = 0;
    let totalSent = 0;
    let totalFailed = 0;
    let totalUsers = 0;
    let retries = 0;
    const MAX_RETRIES = 3;

    try {
      while (true) {
        if (abortRef.current) break;
        try {
          const body: any = { action: "send-announcement", batchSize, offset, campaign };
          if (subject) body.subject = subject;
          if (htmlContent) body.html = htmlContent;
          const res = await apiFetch("/admin", { method: "POST", body });
          totalSent += res.sent;
          totalFailed += res.failed;
          totalUsers = res.totalUsers;
          setProgress({ sent: totalSent, failed: totalFailed, total: totalUsers });
          retries = 0;

          if (!res.hasMore) break;
          offset = res.nextOffset;
          await new Promise((r) => setTimeout(r, 500));
        } catch (batchErr: any) {
          retries++;
          if (retries >= MAX_RETRIES) throw batchErr;
          console.warn(`[Announcement] Batch at offset ${offset} failed, retry ${retries}/${MAX_RETRIES}`);
          await new Promise((r) => setTimeout(r, 2000 * retries));
        }
      }
      setResult({ done: true, sent: totalSent, failed: totalFailed, total: totalUsers });
      fetchStats();
    } catch (err: any) {
      setResult({ error: `${err.message} (${totalSent} sent before error)`, sent: totalSent, failed: totalFailed, canResume: true });
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  const handleSendBackground = async () => {
    if (!confirm(
      "Queue campaign via CRON?\n\n" +
      "Server cron sends batches every 2 minutes until everyone is done. " +
      "You can close this page — delivery continues on the server. " +
      "This is the reliable method (recommended)."
    )) return;
    setSending(true);
    setResult(null);
    setCancelled(false);
    const startingRemaining = stats?.remaining ?? null;
    setBgInitialRemaining(startingRemaining);
    setBgStartedAt(Date.now());
    try {
      const body: any = {
        action: "queue-campaign",
        batchSize: 50,
        campaign,
      };
      if (subject) body.subject = subject;
      if (htmlContent) body.html = htmlContent;
      const res = await apiFetch("/admin", { method: "POST", body });
      setResult({
        background: true,
        queued: true,
        remaining: res.remaining,
        batchSize: res.batchSize,
        message: res.message,
      });
      if (startingRemaining === null && typeof res.remaining === "number") {
        setBgInitialRemaining(res.remaining);
      }
      setBgRunning(true);
      fetchStats();
    } catch (err: any) {
      setResult({ error: err.message });
      setBgRunning(false);
    } finally {
      setSending(false);
    }
  };

  const handleCancelBackground = async () => {
    if (!confirm(`Cancel the in-flight "${campaign}" background campaign?\n\nThe currently-running batch will finish, then the loop stops. Already-sent emails cannot be undone.`)) return;
    setCancelling(true);
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "cancel-announcement", campaign } });
      setCancelled(true);
      // Stop client-side polling immediately; server-side loop will exit
      // after the in-flight batch completes (~5–15s).
      setBgRunning(false);
    } catch (err: any) {
      alert(`Cancel failed: ${err.message}`);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section className="border border-primary/20 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Send className="w-3.5 h-3.5 text-primary" />
          <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">MASS_ANNOUNCEMENT</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDryRun} disabled={dryRunning || sending}
            className="font-mono-share text-xs gap-1.5 border-primary/30 hover:bg-primary/10">
            {dryRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
            DRY_RUN
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleSend(false)} disabled={sending || dryRunning}
            className="font-mono-share text-xs gap-1.5 border-secondary/30 hover:bg-secondary/10 text-secondary">
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {sending ? "SENDING..." : "SEND_TO_ALL"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSendBackground} disabled={sending || dryRunning || bgRunning}
            className="font-mono-share text-xs gap-1.5 border-accent/30 hover:bg-accent/10 text-accent">
            <Send className="w-3 h-3" />
            {bgRunning ? "CRON_RUNNING..." : "QUEUE_VIA_CRON"}
          </Button>
          {bgRunning && (
            <Button variant="outline" size="sm" onClick={handleCancelBackground} disabled={cancelling}
              className="font-mono-share text-xs gap-1.5 border-destructive/30 hover:bg-destructive/10 text-destructive">
              {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {cancelling ? "CANCELLING..." : "CANCEL_BG"}
            </Button>
          )}
          {sending && !bgRunning && (
            <Button variant="outline" size="sm" onClick={() => { abortRef.current = true; }}
              className="font-mono-share text-xs gap-1.5 border-destructive/30 hover:bg-destructive/10 text-destructive">
              ABORT
            </Button>
          )}
        </div>
      </div>

      {/* Stats counter */}
      <div className="flex items-center gap-4 font-mono-share text-[11px]">
        {statsLoading ? (
          <span className="text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading stats...</span>
        ) : stats ? (
          <>
            <span className="text-muted-foreground">Verified: <span className="text-foreground font-bold">{stats.totalVerified}</span></span>
            <span className="text-muted-foreground">Already sent: <span className="text-secondary font-bold">{stats.alreadySent}</span></span>
            <span className="text-muted-foreground">Remaining: <span className="text-primary font-bold">{stats.remaining}</span></span>
            <Button variant="ghost" size="sm" onClick={fetchStats} className="h-5 w-5 p-0">
              <RefreshCw className="w-3 h-3 text-muted-foreground" />
            </Button>
          </>
        ) : null}
      </div>

      {/* Campaign + Subject + Email Editor */}
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="font-mono-share text-[10px] text-muted-foreground/70">CAMPAIGN</label>
          <select
            value={campaign}
            onChange={(e) => {
              const next = e.target.value as typeof campaign;
              setCampaign(next);
              setSubject(CAMPAIGN_SUBJECTS[next] ?? CAMPAIGN_SUBJECTS.announcement);
            }}
            className="w-full bg-background/50 border border-primary/20 rounded px-2 py-1.5 font-mono-share text-xs text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="announcement_launch">🚀 GLTCH Runner Launch — rebrand + AI models + video (NEW)</option>
            <option value="announcement_v52">v5.2 — Self-Hosted Backend + Reliability</option>
            <option value="announcement_v49">v4.9 — Subscription fix + Prompt Board</option>
            <option value="announcement_v48">v4.8 — Signal Boost (chat + locks + +10 credits)</option>
            <option value="announcement_v47">v4.7 — Coolest Updates Drop</option>
            <option value="announcement">Original "Massive Upgrade" announcement</option>
          </select>
          <p className="font-mono-share text-[9px] text-muted-foreground/50">
            Each campaign tracks its own send list. Use <span className="text-accent">QUEUE_VIA_CRON</span> for reliable delivery (recommended).
          </p>
        </div>
        <div className="space-y-1">
          <label className="font-mono-share text-[10px] text-muted-foreground/70">SUBJECT LINE</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-background/50 border border-primary/20 rounded px-2 py-1.5 font-mono-share text-xs text-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div>
          <button
            onClick={() => setShowEditor(!showEditor)}
            className="flex items-center gap-1.5 font-mono-share text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            <Edit className="w-3 h-3" />
            {showEditor ? "HIDE" : "EDIT"} EMAIL HTML
            {showEditor ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showEditor && (
            <div className="mt-2 space-y-2">
              <textarea
                value={htmlContent}
                onChange={(e) => setHtmlContent(e.target.value)}
                placeholder="Paste custom HTML here, or leave blank to use the campaign's default template..."
                className="w-full h-48 bg-background/50 border border-primary/20 rounded px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-primary/50 resize-y"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}
                  className="font-mono-share text-[10px] gap-1 border-primary/20 hover:bg-primary/10">
                  <Eye className="w-3 h-3" />
                  {showPreview ? "HIDE" : "SHOW"} PREVIEW
                </Button>
                {!htmlContent && (
                  <Button variant="outline" size="sm" onClick={() => {
                    apiFetch("/admin", { method: "POST", body: { action: "get-announcement-html", campaign } })
                      .then((r) => setHtmlContent(r.html))
                      .catch(() => setHtmlContent("<!-- Failed to load default template -->"));
                  }}
                    className="font-mono-share text-[10px] gap-1 border-primary/20 hover:bg-primary/10">
                    LOAD DEFAULT TEMPLATE
                  </Button>
                )}
              </div>
              {showPreview && htmlContent && (
                <div className="border border-primary/20 rounded bg-background/80 p-1">
                  <iframe
                    srcDoc={htmlContent}
                    className="w-full h-64 rounded border-0"
                    title="Email Preview"
                    sandbox=""
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="font-mono-share text-[10px] text-muted-foreground/50">
        Sends the announcement to all verified users who haven't received it yet. Edit the subject and HTML above before sending.
      </p>

      {progress && (
        <div className="space-y-1">
          <div className="flex justify-between font-mono-share text-[10px]">
            <span className="text-primary">{progress.sent} sent</span>
            {progress.failed > 0 && <span className="text-destructive">{progress.failed} failed</span>}
            <span className="text-muted-foreground">{progress.sent + progress.failed} / {progress.total}</span>
          </div>
          <div className="w-full bg-muted/30 rounded-full h-1.5">
            <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${Math.round(((progress.sent + progress.failed) / progress.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {result?.dryRun && (
        <div className="bg-primary/5 border border-primary/20 rounded p-3 space-y-2">
          <div className="font-mono-share text-xs text-primary">DRY RUN: {result.totalUsers} verified users would receive the email</div>
          <div className="font-mono-share text-[9px] text-muted-foreground/60 max-h-32 overflow-y-auto">
            {result.emails?.slice(0, 20).join(", ")}{result.emails?.length > 20 ? ` ...and ${result.emails.length - 20} more` : ""}
          </div>
        </div>
      )}

      {result?.done && (
        <div className="bg-secondary/5 border border-secondary/20 rounded p-3 font-mono-share text-xs">
          <span className="text-secondary">✓ Complete:</span> {result.sent} sent, {result.failed} failed out of {result.total} users
        </div>
      )}

      {result?.background && (() => {
        const baseline = bgInitialRemaining ?? result.total ?? 0;
        const currentRemaining = stats?.remaining ?? result.remaining ?? baseline;
        const sentSoFar = Math.max(0, baseline - currentRemaining);
        const pct = baseline > 0 ? Math.min(100, Math.round((sentSoFar / baseline) * 100)) : 0;
        const elapsedSec = bgStartedAt ? Math.floor((Date.now() - bgStartedAt) / 1000) : 0;
        const rate = elapsedSec > 0 ? sentSoFar / elapsedSec : 0; // emails/sec
        const etaSec = rate > 0 ? Math.round(currentRemaining / rate) : null;
        const etaLabel = etaSec === null
          ? "—"
          : etaSec < 60
            ? `${etaSec}s`
            : etaSec < 3600
              ? `${Math.round(etaSec / 60)}m`
              : `${(etaSec / 3600).toFixed(1)}h`;
        const isComplete = currentRemaining === 0;

        return (
          <div className={`border rounded p-3 font-mono-share text-xs space-y-2 ${
            cancelled ? "bg-destructive/5 border-destructive/30"
            : isComplete ? "bg-secondary/5 border-secondary/30"
            : "bg-accent/5 border-accent/20"
          }`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {cancelled
                  ? <span className="text-destructive">⛔ Campaign cancelled — current batch finishes, then loop stops</span>
                  : isComplete
                    ? <span className="text-secondary">✓ Background campaign complete</span>
                    : <><Loader2 className="w-3 h-3 animate-spin text-accent" /><span className="text-accent">Live: campaign running on server</span></>
                }
              </div>
              <span className="text-muted-foreground/70 text-[10px]">
                {bgRunning && !isComplete ? "auto-refreshing every 4s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-background/40 rounded p-2 border border-border/30">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Sent</div>
                <div className="text-lg font-bold text-secondary">{sentSoFar}</div>
              </div>
              <div className="bg-background/40 rounded p-2 border border-border/30">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Remaining</div>
                <div className="text-lg font-bold text-primary">{currentRemaining}</div>
              </div>
              <div className="bg-background/40 rounded p-2 border border-border/30">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Total</div>
                <div className="text-lg font-bold text-foreground">{baseline}</div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground/70">
                <span>{pct}% complete</span>
                <span>elapsed {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s · ETA {etaLabel}</span>
              </div>
              <div className="w-full bg-muted/30 rounded-full h-1.5 overflow-hidden">
                <div className={`h-1.5 rounded-full transition-all ${
                  cancelled ? "bg-destructive"
                  : isComplete ? "bg-secondary"
                  : "bg-accent"
                }`} style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="text-muted-foreground/70 text-[10px]">
              {cancelled
                ? `Cancel signal sent. The remaining ${currentRemaining} users will NOT be emailed. Hit RESUME to continue — already-sent users will be skipped automatically.`
                : isComplete
                  ? `Campaign finished. ${result.failed > 0 ? `${result.failed} failures in the first batch — check email logs.` : ""}`
                  : "Server keeps sending in the background — safe to close this page. Dashboard auto-refreshes from the database."}
            </div>

            {/* Surface a clear warning when the server-to-server continuation
                handoff failed — without this, the loop silently dies and
                Refresh just returns the same 'remaining' count forever. */}
            {result.bgQueueError && !isComplete && (
              <div className="bg-destructive/10 border border-destructive/30 rounded p-2 text-[10px] text-destructive">
                ⚠️ Background loop NOT queued: {result.bgQueueError}
                <div className="text-destructive/70 mt-1">
                  Only the first batch sent. Check that <code>CRON_SECRET</code> is set in the server .env. Hit SEND_IN_BG again to retry.
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {result?.error && (
        <div className="bg-destructive/5 border border-destructive/20 rounded p-3 space-y-2">
          <div className="font-mono-share text-xs text-destructive">
            Error: {result.error}
          </div>
          {result.canResume && (
            <Button variant="outline" size="sm" onClick={() => handleSend(true)} disabled={sending}
              className="font-mono-share text-xs gap-1.5 border-accent/30 hover:bg-accent/10 text-accent">
              <RefreshCw className="w-3 h-3" />
              RESUME (skips already sent)
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// ── Flash Sales Panel ──────────────────────────────────────

interface FlashSale {
  id: string;
  title: string;
  discount_percent: number;
  bonus_credits_percent: number;
  packages: string[] | null;
  starts_at: string;
  ends_at: string;
  max_uses: number | null;
  uses: number;
  active: boolean;
  created_at: string;
}

function FlashSalesPanel() {
  const [sales, setSales] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);

  // Form
  const [title, setTitle] = useState("");
  const [discountPercent, setDiscountPercent] = useState("20");
  const [bonusCreditsPercent, setBonusCreditsPercent] = useState("0");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [maxUses, setMaxUses] = useState("");

  const fetchSales = useCallback(async () => {
    try {
      const data = await apiFetch("/admin", { method: "POST", body: { action: "flash-sales-list" } });
      setSales(data.sales || []);
    } catch (e: any) { alert(e?.message || "Failed to load flash sales"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await apiFetch("/admin", {
        method: "POST",
        body: {
          action: "flash-sales-create",
          title,
          discountPercent,
          bonusCreditsPercent,
          durationMinutes,
          maxUses: maxUses || undefined,
        },
      });
      setTitle("");
      setDiscountPercent("20");
      setBonusCreditsPercent("0");
      setDurationMinutes("60");
      setMaxUses("");
      fetchSales();
    } catch (err: any) {
      alert("Failed: " + err.message);
    } finally { setCreating(false); }
  };

  const handleEnd = async (saleId: string) => {
    if (!confirm("End this flash sale now? Buyers lose the discount immediately.")) return;
    setEnding(saleId);
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "flash-sales-end", saleId } });
      fetchSales();
    } catch (e: any) { alert(e?.message || "Failed to end sale"); }
    finally { setEnding(null); }
  };

  const isActive = (s: FlashSale) => s.active && new Date(s.ends_at) > new Date() && (!s.max_uses || s.uses < s.max_uses);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {/* Create new sale */}
      <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-400" />
          <span className="font-orbitron text-xs tracking-wider text-muted-foreground">CREATE FLASH SALE</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="font-mono-share text-[9px] text-muted-foreground/60">SALE TITLE</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Weekend XRGE Blitz"
              className="w-full px-3 py-2 rounded border border-border/30 bg-input/50 font-mono-share text-xs text-foreground placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono-share text-[9px] text-muted-foreground/60">DURATION (MINUTES)</label>
            <input
              type="number"
              value={durationMinutes}
              onChange={e => setDurationMinutes(e.target.value)}
              placeholder="60"
              className="w-full px-3 py-2 rounded border border-border/30 bg-input/50 font-mono-share text-xs text-foreground"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono-share text-[9px] text-muted-foreground/60">XRGE PRICE DISCOUNT %</label>
            <input
              type="number"
              value={discountPercent}
              onChange={e => setDiscountPercent(e.target.value)}
              min="1" max="90"
              className="w-full px-3 py-2 rounded border border-border/30 bg-input/50 font-mono-share text-xs text-foreground"
            />
            <p className="font-mono-share text-[8px] text-muted-foreground/40">Users pay less XRGE per package</p>
          </div>
          <div className="space-y-1">
            <label className="font-mono-share text-[9px] text-muted-foreground/60">BONUS CREDITS %</label>
            <input
              type="number"
              value={bonusCreditsPercent}
              onChange={e => setBonusCreditsPercent(e.target.value)}
              min="0" max="500"
              className="w-full px-3 py-2 rounded border border-border/30 bg-input/50 font-mono-share text-xs text-foreground"
            />
            <p className="font-mono-share text-[8px] text-muted-foreground/40">Extra credits on top of base (stacks with loyalty)</p>
          </div>
          <div className="space-y-1">
            <label className="font-mono-share text-[9px] text-muted-foreground/60">MAX USES (BLANK = UNLIMITED)</label>
            <input
              type="number"
              value={maxUses}
              onChange={e => setMaxUses(e.target.value)}
              placeholder="∞"
              className="w-full px-3 py-2 rounded border border-border/30 bg-input/50 font-mono-share text-xs text-foreground"
            />
          </div>
        </div>

        <Button
          onClick={handleCreate}
          disabled={creating || !title.trim() || !discountPercent || !durationMinutes}
          className="font-orbitron text-xs tracking-wider gap-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
          LAUNCH FLASH SALE
        </Button>
      </section>

      {/* Sales list */}
      <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground/60" />
          <span className="font-orbitron text-xs tracking-wider text-muted-foreground">ALL FLASH SALES</span>
          <span className="font-mono-share text-[9px] text-muted-foreground/40">({sales.length})</span>
        </div>

        {sales.length === 0 ? (
          <p className="font-mono-share text-xs text-muted-foreground/40 py-4 text-center">No flash sales created yet</p>
        ) : (
          <div className="space-y-2">
            {sales.map(s => {
              const active = isActive(s);
              const endsAt = new Date(s.ends_at);
              const remaining = Math.max(0, Math.round((endsAt.getTime() - Date.now()) / 60000));
              return (
                <div
                  key={s.id}
                  className={`rounded-lg border p-3 space-y-1.5 ${
                    active
                      ? "border-orange-500/30 bg-orange-500/5"
                      : "border-border/20 bg-card/20 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {active && <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />}
                      <span className="font-orbitron text-[10px] tracking-wider text-foreground/80">{s.title}</span>
                    </div>
                    {active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEnd(s.id)}
                        disabled={ending === s.id}
                        className="font-mono-share text-[9px] gap-1 border-destructive/30 text-destructive hover:bg-destructive/10 h-6 px-2"
                      >
                        {ending === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                        END SALE
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 font-mono-share text-[9px] text-muted-foreground/60">
                    <span>Discount: <span className="text-orange-400 font-bold">{s.discount_percent}%</span></span>
                    {s.bonus_credits_percent > 0 && (
                      <span>Bonus: <span className="text-green-400 font-bold">+{s.bonus_credits_percent}%</span></span>
                    )}
                    <span>Uses: <span className="text-foreground">{s.uses}</span>{s.max_uses ? `/${s.max_uses}` : ""}</span>
                    <span>Packages: {s.packages ? s.packages.join(", ") : "ALL"}</span>
                    {active ? (
                      <span>Ends in: <span className="text-orange-300">{remaining}m</span></span>
                    ) : (
                      <span className="text-destructive/60">Ended</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Payouts Panel ──

function PayoutsPanel() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const fetchPayouts = useCallback(async () => {
    try {
      const data = await apiFetch<{ requests: any[] }>("/payouts?admin=1");
      setRequests(data.requests || []);
    } catch (e: any) {
      alert(e?.message || "Failed to load payout requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

  const handleAction = async (requestId: string, action: string, adminNote?: string) => {
    setActing(requestId);
    try {
      await apiFetch("/payouts", { method: "PATCH", body: { requestId, action, adminNote } });
      fetchPayouts();
    } catch (e: any) {
      alert(e?.message || `Payout ${action} failed`);
    } finally {
      setActing(null);
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    pending: "text-amber-400",
    approved: "text-blue-400",
    paid: "text-green-400",
    rejected: "text-destructive",
  };

  if (loading) return <div className="py-8 text-center font-mono-share text-muted-foreground">Loading payouts...</div>;

  return (
    <div className="space-y-4">
      <h2 className="font-orbitron text-xs tracking-widest text-muted-foreground flex items-center gap-2">
        <CreditCard className="w-3.5 h-3.5" /> PAYOUT REQUESTS
      </h2>
      {requests.length === 0 ? (
        <p className="font-mono-share text-xs text-muted-foreground text-center py-8">No payout requests yet</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="border border-border/30 rounded-lg bg-card/40 p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className={`font-orbitron text-[10px] font-bold ${STATUS_COLORS[r.status] || "text-muted-foreground"}`}>
                    {r.status.toUpperCase()}
                  </span>
                  <span className="font-orbitron text-sm text-foreground">${(r.amount_cents / 100).toFixed(2)}</span>
                  <span className="font-mono-share text-[9px] text-muted-foreground">via {r.method}</span>
                </div>
                <span className="font-mono-share text-[9px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="font-mono-share text-[10px] text-muted-foreground space-y-0.5">
                <div>Creator: <span className="text-foreground">{r.username}</span> ({r.email})</div>
                <div>Details: <span className="text-foreground">{r.payout_details}</span></div>
                {r.admin_note && <div>Note: <span className="text-foreground">{r.admin_note}</span></div>}
              </div>
              {r.status === "pending" && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => handleAction(r.id, "approve")}
                    disabled={acting === r.id}
                    className="font-mono-share text-[10px]"
                  >
                    APPROVE
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleAction(r.id, "reject", "Rejected by admin")}
                    disabled={acting === r.id}
                    className="font-mono-share text-[10px]"
                  >
                    REJECT
                  </Button>
                </div>
              )}
              {r.status === "approved" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction(r.id, "paid")}
                  disabled={acting === r.id}
                  className="font-mono-share text-[10px] border-green-400/30 text-green-400"
                >
                  MARK AS PAID
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Admin Page ──

export default function Admin() {
  // User bans
  const [bans, setBans] = useState<any[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banEmail, setBanEmail] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState("permanent");
  const [banning, setBanning] = useState(false);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [revenueBreakdown, setRevenueBreakdown] = useState<any>(null);
  const [referralStats, setReferralStats] = useState<any>(null);
  const [profitBreakdown, setProfitBreakdown] = useState<any[]>([]);
  // Realized ¢/credit for the window, computed server-side off the same rows
  // the cost table uses so the two can't disagree.
  const [serverCentsPerCredit, setServerCentsPerCredit] = useState<number | null>(null);
  const [emailLogs, setEmailLogs] = useState<any[]>([]);
  const [emailStats, setEmailStats] = useState<any>(null);
  const [emailFilter, setEmailFilter] = useState<{ type?: string; status?: string }>({});
  const [emailLoading, setEmailLoading] = useState(false);
  const [apiAnalytics, setApiAnalytics] = useState<any>(null);
  const [apiAnalyticsLoading, setApiAnalyticsLoading] = useState(false);
  const [apiAnalyticsError, setApiAnalyticsError] = useState<string | null>(null);
  // One range drives every chart and KPI on the page. Persisted, so a refresh
  // doesn't snap back to the old hardcoded 30 days.
  const [range, setRange] = useState<ChartRange>(() => loadRange());
  // Per-chart display toggles — kept local because they change nothing about
  // what is fetched, only how it is drawn.
  const [revenueCumulative, setRevenueCumulative] = useState(false);
  const [revenueSplit, setRevenueSplit] = useState(false);
  const [usageMetric, setUsageMetric] = useState<"count" | "credits">("count");
  const [usageStacked, setUsageStacked] = useState(true);
  const [usageTopN, setUsageTopN] = useState(6);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Grant credits
  const [grantEmail, setGrantEmail] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantType, setGrantType] = useState<"pack" | "sub">("pack");
  const [granting, setGranting] = useState(false);
  const [grantResult, setGrantResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Free credits per-source kill switch
  type FcState = {
    master: boolean; daily: boolean; spin: boolean; missions: boolean;
    starter: boolean; starterCredits: number;
    reddit: boolean; envForcedDisabled: boolean; envEnabled: boolean;
  };
  const [fcLoading, setFcLoading] = useState(false);
  const [fcSaving, setFcSaving] = useState<string | null>(null); // key being saved
  const [fcState, setFcState] = useState<FcState | null>(null);
  const [fcResult, setFcResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchFreeCredits = useCallback(async () => {
    setFcLoading(true);
    try {
      const res = await apiFetch<FcState>("/admin/free-credits");
      setFcState(res);
    } catch (err: any) {
      setFcResult({ ok: false, msg: err.message || "Failed to load" });
    } finally {
      setFcLoading(false);
    }
  }, []);

  const updateFreeCreditSource = useCallback(async (key: "master" | "daily" | "spin" | "missions" | "starter", enabled: boolean) => {
    setFcSaving(key); setFcResult(null);
    try {
      const res = await apiFetch<FcState & { ok: boolean }>("/admin/free-credits", { method: "POST", body: { [key]: enabled } });
      setFcState((s) => s ? { ...s, ...res } : s);
      setFcResult({ ok: true, msg: `${key.toUpperCase()} ${enabled ? "ENABLED" : "DISABLED"}` });
    } catch (err: any) {
      setFcResult({ ok: false, msg: err.message || "Failed" });
    } finally {
      setFcSaving(null);
    }
  }, []);

  useEffect(() => { fetchFreeCredits(); }, [fetchFreeCredits]);

  // ── Creator applications queue ─────────────────────────────────
  interface CreatorApp {
    id: string; email: string; handle: string; display_name: string; country: string | null;
    socials: any; pitch: string; niche: string | null; languages: string | null;
    sample_urls: string[]; payout_pref: string; status: string; created_at: string;
    age_confirmed?: boolean;
  }
  const [caStatus, setCaStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [caList, setCaList] = useState<CreatorApp[] | null>(null);
  const [caBusy, setCaBusy] = useState<string | null>(null);

  const fetchCreatorApps = useCallback(async (status: "pending" | "approved" | "rejected") => {
    setCaList(null);
    try {
      const r = await apiFetch<{ applications: CreatorApp[] }>("/creator-applications", {
        method: "POST", body: { action: "list", status },
      });
      setCaList(r.applications || []);
    } catch {
      setCaList([]);
    }
  }, []);

  const reviewCreatorApp = useCallback(async (id: string, decision: "approve" | "reject") => {
    setCaBusy(id);
    try {
      await apiFetch("/creator-applications", { method: "POST", body: { action: "review", id, decision } });
      setCaList((l) => l ? l.filter((a) => a.id !== id) : l);
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setCaBusy(null);
    }
  }, []);

  useEffect(() => { fetchCreatorApps(caStatus); }, [caStatus, fetchCreatorApps]);




  // Feed moderators
  const [modEmail, setModEmail] = useState("");
  const [mods, setMods] = useState<any[]>([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [modAction, setModAction] = useState(false);
  const [modResult, setModResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // User inspector
  const [inspectEmail, setInspectEmail] = useState("");
  const [inspectData, setInspectData] = useState<any>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectTab, setInspectTab] = useState<"prompts" | "posts" | "stories">("prompts");

  const fetchMods = useCallback(async () => {
    setModsLoading(true);
    try {
      const res = await apiFetch("/admin", { method: "POST", body: { action: "list-mods" } });
      setMods(res.mods || []);
    } catch (err: any) {
      console.error("[admin] list-mods failed:", err.message);
    } finally { setModsLoading(false); }
  }, []);

  const fetchBans = useCallback(async () => {
    setBansLoading(true);
    try {
      const res = await apiFetch("/admin", { method: "POST", body: { action: "list-bans" } });
      setBans(res.bans || []);
    } catch (err: any) {
      console.error("[admin] list-bans failed:", err.message);
    } finally { setBansLoading(false); }
  }, []);

  const inspectByEmail = useCallback(async (email: string) => {
    setInspecting(true);
    try {
      const res = await apiFetch("/admin", { method: "POST", body: { action: "user-inspect", email: email.trim() } });
      setInspectData(res);
    } catch (err: any) {
      alert(err.message);
      setInspectData(null);
    } finally { setInspecting(false); }
  }, []);

  const handleInspect = useCallback(async () => {
    if (!inspectEmail.trim()) return;
    inspectByEmail(inspectEmail);
  }, [inspectEmail, inspectByEmail]);

  const handleBan = async () => {
    if (!banEmail.trim()) return;
    if (!confirm(`Ban ${banEmail.trim()} (${banDuration})? This also zeroes their karma.`)) return;
    setBanning(true);
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "ban-user", email: banEmail.trim(), reason: banReason.trim() || undefined, duration: banDuration === "permanent" ? undefined : banDuration } });
      setBanEmail(""); setBanReason(""); setBanDuration("permanent");
      fetchBans();
    } catch (err: any) {
      alert(err.message);
    } finally { setBanning(false); }
  };

  const handleUnban = async (userId: string) => {
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "unban-user", userId } });
      fetchBans();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const fetchEmailLogs = useCallback(async (filters?: { type?: string; status?: string }) => {
    setEmailLoading(true);
    try {
      const body: any = { action: "email-logs", limit: 100 };
      if (filters?.type) body.email_type = filters.type;
      if (filters?.status) body.status = filters.status;
      const res = await apiFetch("/admin", { method: "POST", body });
      setEmailLogs(res.logs || []);
      setEmailStats(res.stats || null);
    } catch (err: any) {
      console.error("[admin] email-logs failed:", err.message);
    } finally {
      setEmailLoading(false);
    }
  }, []);

  // Delete failed/bounced/complained email_log rows. After deletion the
  // dedup filter in send-announcement no longer skips those recipients,
  // so a re-run of the campaign will retry them.
  const deleteFailedEmails = useCallback(async (
    payload: { ids?: string[]; campaign?: string; recipient?: string; scope?: "failed" | "all-non-sent" },
    confirmMsg: string,
  ) => {
    if (!confirm(confirmMsg)) return;
    try {
      const res = await apiFetch<{ deleted: number }>("/admin", {
        method: "POST",
        body: { action: "delete-failed-emails", ...payload },
      });
      alert(`Deleted ${res.deleted} log row${res.deleted === 1 ? "" : "s"}.`);
      // Refresh the table so removed rows disappear and stats update.
      await fetchEmailLogs(emailFilter);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }, [fetchEmailLogs, emailFilter]);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    const errors: string[] = [];
    const rangeBody = { days: range.days, ...(range.bucket ? { bucket: range.bucket } : {}) };

    async function fetchAction(action: string, extra: Record<string, unknown> = {}) {
      try {
        return await apiFetch("/admin", { method: "POST", body: { action, ...rangeBody, ...extra } });
      } catch (err: any) {
        const msg = err.message || String(err);
        if (msg.includes("Access denied") || msg.includes("403") || msg.includes("Unauthorized")) {
          throw err;
        }
        console.error(`[admin] ${action} failed:`, msg);
        errors.push(`${action}: ${msg}`);
        return null;
      }
    }

    try {
      const [o, r, u, us, t, tx, ref, rb, pb] = await Promise.all([
        fetchAction("overview"),
        fetchAction("revenue"),
        fetchAction("users"),
        fetchAction("usage"),
        fetchAction("top-users"),
        fetchAction("transactions"),
        fetchAction("referrals"),
        fetchAction("revenue-breakdown"),
        fetchAction("profit-breakdown"),
      ]);

      // The server echoes back the bucket it actually used (AUTO resolves
      // server-side), so axis labels match the real granularity.
      const bucket: string = o?.range?.bucket || r?.range?.bucket || "day";

      if (o) setOverview(o);
      if (r) setRevenue((r.revenue || []).map((row: RevenueRow) => ({ ...row, day: fmtBucket(row.day, bucket) })));
      if (u) setUsers((u.users || []).map((row: UserRow) => ({ ...row, day: fmtBucket(row.day, bucket) })));
      if (us) setUsage((us.usage || []).map((row: UsageRow) => ({ ...row, day: fmtBucket(row.day, bucket) })));
      if (t) setTopUsers(t.topUsers || []);
      if (tx) setTransactions(tx.transactions || []);
      if (ref) setReferralStats(ref.referrals || null);
      if (rb) setRevenueBreakdown(rb);
      if (pb) {
        setProfitBreakdown(pb.profitBreakdown || []);
        setServerCentsPerCredit(typeof pb.centsPerCredit === "number" ? pb.centsPerCredit : null);
      }

      setAuthorized(true);
      setError(errors.length > 0 ? errors.join(" | ") : null);
    } catch {
      setAuthorized(false);
      setError(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range.days, range.bucket]);

  const syncSubscriptions = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await apiFetch("/admin", { method: "POST", body: { action: "sync-subscriptions" } });
      setSyncResult(result);
      fetchAll();
    } catch (err: any) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    if (!hasAuthToken()) {
      setLoading(false);
      setAuthorized(false);
      return;
    }
    fetchAll();
    fetchMods();
    fetchBans();
  }, [fetchAll, fetchMods, fetchBans]);

  useEffect(() => {
    if (activeTab === "emails" && !emailStats && !emailLoading && authorized) {
      fetchEmailLogs();
    }
  }, [activeTab, emailStats, emailLoading, authorized, fetchEmailLogs]);

  const fetchApiAnalytics = useCallback(async () => {
    setApiAnalyticsLoading(true);
    setApiAnalyticsError(null);
    try {
      const res = await apiFetch("/admin", { method: "POST", body: { action: "api-analytics" } });
      setApiAnalytics(res);
    } catch (err: any) {
      console.error("[admin] api-analytics failed:", err.message);
      // must set an error: with analytics still null the load effect would refire forever
      setApiAnalyticsError(err?.message || "Failed to load API analytics");
    } finally {
      setApiAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "api" && !apiAnalytics && !apiAnalyticsLoading && !apiAnalyticsError && authorized) {
      fetchApiAnalytics();
    }
  }, [activeTab, apiAnalytics, apiAnalyticsLoading, apiAnalyticsError, authorized, fetchApiAnalytics]);

  useEffect(() => {
    // Range change invalidates the lazily-loaded API tab too.
    setApiAnalytics(null);
    setApiAnalyticsError(null);
  }, [range.days, range.bucket]);

  /**
   * Long-tail modes are folded into OTHER: past ~8 series a stacked chart is
   * unreadable and the legend is longer than the plot.
   */
  const { usagePivot, usageModes } = React.useMemo(() => {
    const key = usageMetric === "credits" ? "credits" : "count";
    const totals = new Map<string, number>();
    for (const row of usage) {
      totals.set(row.mode, (totals.get(row.mode) || 0) + Number(row[key] || 0));
    }
    const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, usageTopN).map(([m]) => m);
    const topSet = new Set(top);
    const hasOther = ranked.length > top.length;

    const map = new Map<string, { day: string } & Record<string, number>>();
    // usage rows arrive pre-formatted and already ordered by bucket, so
    // insertion order is chronological.
    for (const row of usage) {
      const entry = map.get(row.day) ?? ({ day: row.day } as { day: string } & Record<string, number>);
      const series = topSet.has(row.mode) ? row.mode : "OTHER";
      const rec = entry as Record<string, number>;
      rec[series] = (rec[series] || 0) + Number(row[key] || 0);
      map.set(row.day, entry);
    }
    return {
      usagePivot: Array.from(map.values()),
      usageModes: hasOther ? [...top, "OTHER"] : top,
    };
  }, [usage, usageMetric, usageTopN]);

  // ── Loading / Auth gates ──
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!authorized && !error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <ShieldAlert className="w-16 h-16 text-destructive mx-auto" />
          <h1 className="font-orbitron text-xl tracking-wider text-destructive">ACCESS_DENIED</h1>
          <p className="font-mono-share text-sm text-muted-foreground">Admin credentials required.</p>
          <Button variant="outline" onClick={() => navigate("/")} className="font-mono-share text-xs gap-2">
            <ArrowLeft className="w-3.5 h-3.5" />
            RETURN_TO_GRID
          </Button>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <ShieldAlert className="w-16 h-16 text-destructive/60 mx-auto" />
          <h1 className="font-orbitron text-xl tracking-wider text-destructive">SYSTEM_ERROR</h1>
          <p className="font-mono-share text-sm text-muted-foreground max-w-md">{error || "Failed to load data"}</p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate("/")} className="font-mono-share text-xs gap-2">
              <ArrowLeft className="w-3.5 h-3.5" />
              RETURN
            </Button>
            <Button variant="outline" onClick={fetchAll} disabled={refreshing} className="font-mono-share text-xs gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              RETRY
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const o = overview;
  const winLabel = rangeLabel(range.days);
  // Cost is now split by who sends the bill rather than by one blanket
  // per-credit rate, so the RunPod and xAI cards no longer describe the same
  // jobs twice.
  const runpodCost = o.cost.byProvider.runpod?.blendedCents ?? 0;
  const xaiCost = o.cost.byProvider.xai?.blendedCents ?? 0;
  const seedanceCost = o.cost.byProvider.seedance?.blendedCents ?? 0;
  const totalCost = o.cost.blendedCents;
  const trueMargin = o.margin.grossCents;
  // Realized ¢/credit for the window, from the server so the overview cards
  // and the unit-economics table can't drift apart.
  const centsPerCredit = serverCentsPerCredit ?? o.margin.revenuePerCredit ?? 0;
  const costCoverage = `${o.cost.trackedRows.toLocaleString()}/${o.cost.jobRows.toLocaleString()} measured (${fmtPct(o.cost.coverage)})`;

  return (
    <div className="min-h-screen bg-background w-full overflow-x-hidden">
      {/* Partial-load warning: overview loaded but a secondary query failed */}
      {error && (
        <div className="bg-amber-500/10 border-b border-amber-500/40 px-4 py-2 flex items-center gap-2 font-mono-share text-[11px] text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">PARTIAL_LOAD — some sections failed: {error}</span>
          <button onClick={fetchAll} className="ml-auto shrink-0 underline hover:text-amber-200">RETRY</button>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-border/30 bg-card/40 backdrop-blur-sm sticky top-0 z-20" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 font-mono-share text-xs shrink-0 px-2">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">BACK</span>
            </Button>
            <div className="h-4 w-px bg-border/30 shrink-0 hidden sm:block" />
            <h1 className="font-orbitron text-xs sm:text-sm tracking-wider neon-text-cyan flex items-center gap-1.5 min-w-0">
              <Server className="w-4 h-4 shrink-0" />
              <span className="truncate">ADMIN</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono-share text-[9px] text-muted-foreground/40 hidden md:inline">Admin</span>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAll}
              disabled={refreshing}
              className="font-mono-share text-xs gap-1.5 px-2 sm:px-3"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">REFRESH</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Two-tier tab bar: group clusters, then that group's tabs */}
      <nav className="border-b border-border/20 bg-card/20 backdrop-blur-sm sticky top-[53px] z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 pt-2 flex gap-1.5 overflow-x-auto scrollbar-hide fade-edge-x">
          {TAB_GROUPS.map((group) => {
            const active = group.tabs.includes(activeTab);
            return (
              <button
                key={group.id}
                onClick={() => { if (!active) setActiveTab(group.tabs[0]); }}
                className={`px-3.5 py-1.5 rounded-full font-orbitron text-[10px] tracking-widest whitespace-nowrap transition-all duration-200 hover-lift ${
                  active
                    ? "bg-primary/15 text-primary shadow-[0_0_14px_hsl(var(--primary)/0.2),inset_0_0_0_1px_hsl(var(--primary)/0.45)]"
                    : "text-muted-foreground/60 hover:text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.4)] hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)]"
                }`}
              >
                {group.label}
              </button>
            );
          })}
        </div>
        <div className="max-w-7xl mx-auto px-3 sm:px-4 flex gap-0.5 overflow-x-auto scrollbar-hide fade-edge-x">
          {groupOfTab(activeTab).tabs.map((id) => {
            const tab = tabById(id);
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 font-orbitron text-[9px] sm:text-[10px] tracking-wider border-b-2 transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-card/40"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="admin-shell max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* Standalone admin pages. These live on their own routes rather than
            as tabs, and nothing linked to them — /admin/stripe-prices and
            /admin/promo were both reachable only by typing the URL. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono-share text-[9px] tracking-widest text-muted-foreground/50">TOOLS:</span>
          <Link
            to="/admin/promo"
            className="px-2.5 py-1 rounded border border-cyan-500/30 bg-cyan-500/5 font-mono-share text-[10px] text-cyan-300/80 hover:border-cyan-500/60 hover:text-cyan-300 transition-colors"
          >
            PROMO_REVIEW
          </Link>
          <Link
            to="/admin/stripe-prices"
            className="px-2.5 py-1 rounded border border-border/50 bg-card/40 font-mono-share text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            STRIPE_PRICES
          </Link>
        </div>

        {/* ═══ OVERVIEW TAB ═══ */}
        {activeTab === "overview" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <RangeControl value={range} onChange={setRange} />
              <span className="font-mono-share text-[10px] text-muted-foreground/50 ml-auto">
                every figure below covers the selected window
              </span>
            </div>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard icon={<Users className="w-4 h-4" />} label="TOTAL_USERS" value={o.users.total_users.toLocaleString()} sub={`${o.users.verified_users.toLocaleString()} verified // +${o.users.new_this_week} this week`} />
              <KpiCard icon={<DollarSign className="w-4 h-4" />} label={`REVENUE_${winLabel}`} value={fmt$(o.revenue.revenue_window_cents)} sub={`${fmt$(o.revenue.total_revenue_cents)} lifetime // ${o.revenue.paying_users} payers`} accent="secondary" />
              <KpiCard icon={<Zap className="w-4 h-4" />} label={`CREDITS_USED_${winLabel}`} value={o.usage.credits_window.toLocaleString()} sub={`${o.usage.generations_window.toLocaleString()} gens // ${o.usage.active_users_window.toLocaleString()} active users`} />
              <KpiCard icon={<Crown className="w-4 h-4" />} label="SUBSCRIBERS" value={o.users.active_subscribers} sub={`${o.users.cancelling_subscribers} cancelling // ${o.revenue.sub_renewals} renewals booked`} accent="secondary" />
            </section>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard icon={<Server className="w-4 h-4" />} label={`RUNPOD_${winLabel}`} value={fmt$(runpodCost)} sub={`${(o.cost.byProvider.runpod?.jobs ?? 0).toLocaleString()} GPU jobs`} accent="destructive" />
              <KpiCard icon={<CreditCard className="w-4 h-4" />} label={`xAI_${winLabel}`} value={fmt$(xaiCost)} sub={xaiCost > 0 ? `${(o.cost.byProvider.xai?.jobs ?? 0).toLocaleString()} legacy jobs` : "no xAI jobs in window"} accent="destructive" />
              <KpiCard icon={<Activity className="w-4 h-4" />} label={`TOTAL_COST_${winLabel}`} value={fmt$(totalCost)} sub={costCoverage} accent="destructive" />
              <KpiCard icon={<TrendingUp className="w-4 h-4" />} label={`GROSS_MARGIN_${winLabel}`} value={fmt$(trueMargin)} sub={`${fmtPct(o.margin.marginPct)} of revenue`} accent={trueMargin >= 0 ? "secondary" : "destructive"} />
            </section>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard icon={<Zap className="w-4 h-4" />} label="CREDIT_UNIT_ECON" value={`${o.margin.revenuePerCredit.toFixed(2)}¢`} sub={`sold // ${o.margin.costPerCredit.toFixed(2)}¢ to serve`} accent={o.margin.revenuePerCredit >= o.margin.costPerCredit ? "secondary" : "destructive"} />
              <KpiCard icon={<Activity className="w-4 h-4" />} label="CREDITS_OUTSTANDING" value={fmtCompact(o.creditPool.total_sub_credits_outstanding + o.creditPool.total_pack_credits_outstanding + o.creditPool.total_daily_credits_outstanding)} sub={`liability ≈ ${fmt$(Math.round((o.creditPool.total_sub_credits_outstanding + o.creditPool.total_pack_credits_outstanding) * o.margin.costPerCredit))} to serve`} />
              <KpiCard icon={<Undo2 className="w-4 h-4" />} label={`REFUNDED_${winLabel}`} value={o.usage.refunded_window.toLocaleString()} sub={`${o.usage.refunded_generations.toLocaleString()} lifetime // ${o.usage.refunded_credits.toLocaleString()} credits back`} accent={o.usage.refunded_window > 0 ? "destructive" : "primary"} />
              <KpiCard icon={<Gift className="w-4 h-4" />} label="ADMIN_GRANTS" value={o.revenue.grant_rows.toLocaleString()} sub={`${o.revenue.granted_credits.toLocaleString()} credits, $0 revenue`} />
            </section>

            <p className="font-mono-share text-[10px] text-muted-foreground/50 leading-relaxed">
              Revenue counts only rows where money moved — the {o.revenue.grant_rows.toLocaleString()} admin grants are
              excluded, as are refunded generations from credit totals. Cost is measured per job where RunPod reported an
              execution time and inferred from that mode's own observed average where it didn't. For fees, refunds and
              what actually reached the bank, see FINANCE.
            </p>
          </>
        )}

        {/* ═══ FINANCE TAB ═══ */}
        {activeTab === "finance" && <AdminFinancePanel range={range} onRangeChange={setRange} />}

        {/* ═══ AMBASSADORS TAB ═══ */}
        {activeTab === "ambassadors" && <AdminAmbassadorPanel />}

        {/* ═══ INSIGHTS TAB ═══ */}
        {activeTab === "insights" && <AdminInsightsPanel />}

        {/* ═══ MEDIA ERRORS TAB ═══ */}
        {activeTab === "media-errors" && <MediaErrorsPanel />}

        {activeTab === "purges" && <PurgeLogPanel />}

        {/* ═══ REVENUE TAB ═══ */}
        {activeTab === "revenue" && (
          <>
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5" />
                  REVENUE_STREAM
                </h2>
                <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                  <ChartToggle active={revenueSplit} onClick={() => setRevenueSplit((v) => !v)} title="Split packs from subscriptions">SPLIT</ChartToggle>
                  <ChartToggle active={revenueCumulative} onClick={() => setRevenueCumulative((v) => !v)} title="Show a running total instead of per-bucket revenue">CUMULATIVE</ChartToggle>
                </div>
              </div>
              <RangeControl value={range} onChange={setRange} className="mb-3" />
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={revenue}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--secondary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--secondary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmt$(v)} width={56} />
                  <Tooltip content={<CyberTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {revenueCumulative ? (
                    <Area type="monotone" dataKey="cumulative_cents" name="Cumulative revenue" stroke="hsl(var(--secondary))" fill="url(#revGrad)" strokeWidth={2} />
                  ) : revenueSplit ? (
                    <>
                      <Bar dataKey="pack_cents" name="Packs" stackId="rev" fill="hsl(var(--primary))" fillOpacity={0.75} />
                      <Bar dataKey="sub_cents" name="Subscriptions" stackId="rev" fill="hsl(var(--secondary))" fillOpacity={0.75} />
                    </>
                  ) : (
                    <Area type="monotone" dataKey="revenue_cents" name="Revenue" stroke="hsl(var(--secondary))" fill="url(#revGrad)" strokeWidth={2} />
                  )}
                  {revenue.length > 24 && (
                    <Brush dataKey="day" height={18} travellerWidth={8} stroke="hsl(var(--primary))" fill="hsl(var(--card))" />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              <p className="font-mono-share text-[10px] text-muted-foreground/50 mt-2">
                Bookings from our own ledger, grants excluded. Fees and refunds are not deducted here — see FINANCE.
              </p>
            </div>

            {revenueBreakdown && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
                  <div className="px-3 sm:px-4 py-3 border-b border-border/30">
                    <h2 className="font-orbitron text-xs tracking-wider text-secondary/80 flex items-center gap-2">
                      <CreditCard className="w-3.5 h-3.5" />
                      REVENUE_BY_PACK ({winLabel})
                    </h2>
                  </div>
                  <div className="overflow-x-auto overscroll-x-contain">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border/20">
                          {["PACK", "TYPE", "COUNT", "REVENUE", "CREDITS", "¢/CR", "AVG"].map((h) => (
                            <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(revenueBreakdown.byPackWindow || revenueBreakdown.byPack30d || []).map((row: any, i: number) => (
                          <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                            <td className="px-2.5 py-2 font-orbitron text-[10px] tracking-wider text-foreground/80">{row.package?.toUpperCase() || "--"}</td>
                            <td className="px-2.5 py-2">
                              <span className={`font-orbitron text-[9px] tracking-wider px-2 py-0.5 rounded border ${
                                row.type === "subscription" ? "bg-secondary/20 text-secondary border-secondary/30" : "bg-primary/20 text-primary border-primary/30"
                              }`}>{row.type?.toUpperCase()}</span>
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-xs font-bold" data-numeric>{row.count}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-secondary font-bold" data-numeric>{fmt$(row.total_cents)}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-primary" data-numeric>{row.total_credits?.toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/70" data-numeric title="Cents of revenue per credit sold">
                              {row.cents_per_credit ? Number(row.cents_per_credit).toFixed(2) : "--"}
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/70" data-numeric title="Average order value">
                              {fmt$(row.avg_cents)}
                            </td>
                          </tr>
                        ))}
                        {(revenueBreakdown.byPackWindow || []).length === 0 && (
                          <tr><td colSpan={7} className="px-2.5 py-6 text-center font-mono-share text-[10px] text-muted-foreground/40">no purchases in this window</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {(revenueBreakdown.grants || []).length > 0 && (
                    <div className="px-3 sm:px-4 py-3 border-t border-border/20">
                      <h3 className="font-orbitron text-[9px] tracking-wider text-muted-foreground/50 mb-2">
                        ADMIN_GRANTS — $0, excluded from every revenue figure above
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {(revenueBreakdown.grants || []).map((g: any, i: number) => (
                          <span key={i} className="font-mono-share text-[10px] px-2 py-1 rounded border border-border/30 bg-muted/10 text-muted-foreground/70">
                            {g.package || "--"}: {g.count.toLocaleString()} rows // {g.credits.toLocaleString()} credits
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
                  <div className="px-3 sm:px-4 py-3 border-b border-border/30">
                    <h2 className="font-orbitron text-xs tracking-wider text-secondary/80 flex items-center gap-2">
                      <DollarSign className="w-3.5 h-3.5" />
                      REVENUE_BY_GATEWAY (lifetime)
                    </h2>
                  </div>
                  <div className="p-3 sm:p-4 space-y-2">
                    {(revenueBreakdown.byGateway || []).map((row: any, i: number) => {
                      const totalCents = (revenueBreakdown.byGateway || []).reduce((s: number, r: any) => s + (r.total_cents || 0), 0);
                      const pct = totalCents > 0 ? Math.round((row.total_cents / totalCents) * 100) : 0;
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className={`font-mono-share text-[10px] font-bold px-2 py-0.5 rounded ${
                              row.gateway === "stripe" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                              : row.gateway === "paypal" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                              : row.gateway === "xrge" ? "bg-pink-500/20 text-pink-400 border border-pink-500/30"
                              : "bg-muted/20 text-muted-foreground"
                            }`}>{row.gateway === "xrge" ? "$XRGE" : row.gateway === "xrge-bank" ? "$XRGE_BANK" : row.gateway?.toUpperCase()}</span>
                            <div className="flex items-center gap-3">
                              <span className="font-mono-share text-[10px] text-muted-foreground/60">{row.count} txns</span>
                              <span className="font-mono-share text-sm text-secondary font-bold">{fmt$(row.total_cents)}</span>
                              <span className="font-mono-share text-[10px] text-muted-foreground/40">{pct}%</span>
                            </div>
                          </div>
                          <div className="w-full bg-border/20 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              row.gateway === "stripe" ? "bg-indigo-500" : row.gateway === "paypal" ? "bg-blue-500" : row.gateway?.startsWith("xrge") ? "bg-pink-500" : "bg-muted-foreground"
                            }`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Stripe's own payment-method mix. `payment_method` holds the
                      Stripe type (card / link / apple_pay / klarna / …), which the
                      gateway rollup above collapses into a single "STRIPE" bar. */}
                  {(revenueBreakdown.byMethod || []).length > 0 && (
                    <div className="px-3 sm:px-4 py-3 border-t border-border/20">
                      <h3 className="font-orbitron text-[9px] tracking-wider text-muted-foreground/50 mb-2">PAYMENT_METHOD_MIX (lifetime)</h3>
                      <div className="overflow-x-auto overscroll-x-contain">
                        <table className="w-full">
                          <thead><tr className="border-b border-border/20">
                            {["METHOD", "#", "REVENUE", `${winLabel}`].map((h) => (
                              <th key={h} className="px-2 py-1 text-left font-mono-share text-[8px] text-muted-foreground/40 tracking-wider">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {(revenueBreakdown.byMethod || []).slice(0, 12).map((m: any, i: number) => (
                              <tr key={i} className="border-b border-border/10">
                                <td className="px-2 py-1 font-mono-share text-[10px] text-foreground/75">{m.method}</td>
                                <td className="px-2 py-1 font-mono-share text-[10px] text-muted-foreground/70" data-numeric>{m.count.toLocaleString()}</td>
                                <td className="px-2 py-1 font-mono-share text-[10px] text-secondary" data-numeric>{fmt$(m.total_cents)}</td>
                                <td className="px-2 py-1 font-mono-share text-[10px] text-muted-foreground/60" data-numeric>{fmt$(m.window_cents)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div className="px-3 sm:px-4 py-3 border-t border-border/20">
                    <h3 className="font-orbitron text-[9px] tracking-wider text-muted-foreground/50 mb-2">ALL_TIME_BY_PACK</h3>
                    <div className="overflow-x-auto overscroll-x-contain">
                      <table className="w-full">
                        <thead><tr className="border-b border-border/20">
                          {["PACK", "TYPE", "#", "REVENUE"].map((h) => (
                            <th key={h} className="px-2 py-1 text-left font-mono-share text-[8px] text-muted-foreground/40 tracking-wider">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {(revenueBreakdown.byPack || []).map((row: any, i: number) => (
                            <tr key={i} className="border-b border-border/5">
                              <td className="px-2 py-1 font-mono-share text-[10px] text-foreground/70">{row.package?.toUpperCase() || "--"}</td>
                              <td className="px-2 py-1 font-mono-share text-[9px] text-muted-foreground/50">{row.type}</td>
                              <td className="px-2 py-1 font-mono-share text-[10px]">{row.count}</td>
                              <td className="px-2 py-1 font-mono-share text-[10px] text-secondary">{fmt$(row.total_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
              <div className="px-3 sm:px-4 py-3 border-b border-border/30 flex items-center justify-between">
                <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
                  <Receipt className="w-3.5 h-3.5" />
                  TRANSACTION_LOG (last 100)
                </h2>
                <span className="font-mono-share text-[10px] text-muted-foreground/40">{transactions.length} records</span>
              </div>
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[560px]">
                  <thead><tr className="border-b border-border/20">
                    {["DATE", "USER", "TYPE", "PKG", "CR", "AMT", "VIA"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {transactions.map((tx, i) => (
                      <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/60 whitespace-nowrap">
                          {new Date(tx.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{tx.email || "unknown"}</td>
                        <td className="px-2.5 py-2">
                          <span className={`font-orbitron text-[9px] tracking-wider px-2 py-0.5 rounded border ${
                            tx.type === "subscription" ? "bg-secondary/20 text-secondary border-secondary/30" : "bg-primary/20 text-primary border-primary/30"
                          }`}>{tx.type?.toUpperCase() || "--"}</span>
                        </td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/70">{tx.package?.toUpperCase() || "--"}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-primary font-bold">{tx.credits}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-secondary">{fmt$(tx.amount_cents)}</td>
                        <td className="px-2.5 py-2">
                          <span className={`font-mono-share text-[9px] px-2 py-0.5 rounded ${
                            tx.gateway === "stripe" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                            : tx.gateway === "paypal" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            : tx.gateway === "xrge" ? "bg-pink-500/20 text-pink-400 border border-pink-500/30"
                            : "bg-muted/20 text-muted-foreground"
                          }`}>{tx.gateway === "xrge" ? "$XRGE" : tx.gateway?.toUpperCase() || "--"}</span>
                        </td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center font-mono-share text-xs text-muted-foreground/40">No transactions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ═══ USERS TAB ═══ */}
        {activeTab === "users" && (
          <>
            {/*
              Was an AreaChart with a <Bar> inside it, which recharts silently
              dropped — so "New Users" never rendered. ComposedChart draws both,
              on separate axes because a ~100/day signup count is invisible next
              to a 28k cumulative line.
            */}
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
              <h2 className="font-orbitron text-xs tracking-wider text-primary/80 mb-3 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" />
                USER_GROWTH
              </h2>
              <RangeControl value={range} onChange={setRange} className="mb-3" />
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={users}>
                  <defs>
                    <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis yAxisId="total" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmtCompact} width={42} />
                  <YAxis yAxisId="new" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--secondary))" }} tickFormatter={fmtCompact} width={42} />
                  <Tooltip content={<CyberTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Area yAxisId="total" type="monotone" dataKey="cumulative" name="Total users" stroke="hsl(var(--primary))" fill="url(#userGrad)" strokeWidth={2} />
                  <Bar yAxisId="new" dataKey="new_users" name="New signups" fill="hsl(var(--secondary))" fillOpacity={0.6} />
                  <Line yAxisId="new" type="monotone" dataKey="verified" name="Verified" stroke="hsl(var(--secondary))" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                  {users.length > 24 && (
                    <Brush dataKey="day" height={18} travellerWidth={8} stroke="hsl(var(--primary))" fill="hsl(var(--card))" />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              <p className="font-mono-share text-[10px] text-muted-foreground/50 mt-2">
                Total users is a true running count from day zero, so a short window still shows the real headcount.
              </p>
            </div>

            {/* Grant Credits */}
            <section className="border border-secondary/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 space-y-3">
              <h2 className="font-orbitron text-xs tracking-wider text-secondary/80 flex items-center gap-2">
                <Gift className="w-3.5 h-3.5" />
                GRANT_CREDITS
              </h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[180px]">
                  <label className="font-mono-share text-[9px] text-muted-foreground/60 block mb-1">EMAIL</label>
                  <input type="email" value={grantEmail} onChange={e => setGrantEmail(e.target.value)} placeholder="user@example.com"
                    className="w-full bg-background/60 border border-border rounded px-2.5 py-1.5 font-mono-share text-xs text-foreground placeholder-muted-foreground/40" />
                </div>
                <div className="w-24">
                  <label className="font-mono-share text-[9px] text-muted-foreground/60 block mb-1">AMOUNT</label>
                  <input type="number" value={grantAmount} onChange={e => setGrantAmount(e.target.value)} placeholder="100" min="1" max="50000"
                    className="w-full bg-background/60 border border-border rounded px-2.5 py-1.5 font-mono-share text-xs text-foreground placeholder-muted-foreground/40" />
                </div>
                <div className="w-24">
                  <label className="font-mono-share text-[9px] text-muted-foreground/60 block mb-1">TYPE</label>
                  <select value={grantType} onChange={e => setGrantType(e.target.value as "pack" | "sub")}
                    className="w-full bg-background/60 border border-border rounded px-2.5 py-1.5 font-mono-share text-xs text-foreground">
                    <option value="pack">Pack</option>
                    <option value="sub">Sub</option>
                  </select>
                </div>
                <Button variant="outline" size="sm" disabled={granting || !grantEmail.trim() || !grantAmount}
                  className="font-mono-share text-xs gap-1.5 border-secondary/40 hover:bg-secondary/10 text-secondary"
                  onClick={async () => {
                    setGranting(true); setGrantResult(null);
                    try {
                      const res = await apiFetch("/admin", { method: "POST", body: { action: "grant-credits", email: grantEmail.trim(), credits: grantAmount, type: grantType } });
                      setGrantResult({ ok: true, msg: `Granted ${res.granted} ${res.type} credits to ${res.email} (sub=${res.sub_credits}, pack=${res.pack_credits})` });
                      setGrantEmail(""); setGrantAmount("");
                      fetchAll();
                    } catch (err: any) {
                      setGrantResult({ ok: false, msg: err.message || "Failed" });
                    } finally { setGranting(false); }
                  }}>
                  {granting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  GRANT
                </Button>
                <Button variant="outline" size="sm" disabled={granting || !grantEmail.trim()}
                  className="font-mono-share text-xs gap-1.5 border-destructive/40 hover:bg-destructive/10 text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`Zero ALL credits (pack + sub + daily) for ${grantEmail.trim()}?`)) return;
                    setGranting(true); setGrantResult(null);
                    try {
                      const res = await apiFetch("/admin", { method: "POST", body: { action: "zero-credits", email: grantEmail.trim() } });
                      setGrantResult({ ok: true, msg: `Wiped ${res.wiped} credits from ${res.email} (was sub=${res.previous.sub_credits}, pack=${res.previous.pack_credits}, daily=${res.previous.daily_credits})` });
                      setGrantEmail("");
                      fetchAll();
                    } catch (err: any) {
                      setGrantResult({ ok: false, msg: err.message || "Failed" });
                    } finally { setGranting(false); }
                  }}>
                  <Ban className="w-3 h-3" />
                  ZERO
                </Button>
              </div>
              {grantResult && (
                <div className={`font-mono-share text-[10px] px-2 py-1.5 rounded ${grantResult.ok ? "bg-green-500/10 text-green-400" : "bg-destructive/10 text-destructive"}`}>
                  {grantResult.msg}
                </div>
              )}

              {/* Bulk grant — every verified user */}
              <div className="border-t border-border/30 pt-3 mt-1 space-y-2">
                <div className="font-mono-share text-[10px] uppercase tracking-wider text-secondary/70">
                  BULK_GRANT // EVERY VERIFIED USER
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[10, 25, 50].map((amt) => (
                    <Button
                      key={amt}
                      variant="outline"
                      size="sm"
                      disabled={granting}
                      className="font-mono-share text-xs gap-1.5 border-secondary/40 hover:bg-secondary/10 text-secondary"
                      onClick={async () => {
                        if (!confirm(`Grant ${amt} pack credits to ALL verified users? This cannot be undone.`)) return;
                        setGranting(true); setGrantResult(null);
                        try {
                          const res = await apiFetch<{ recipients: number; totalUsers: number; amount: number }>("/admin", {
                            method: "POST",
                            body: { action: "grant-all-credits", credits: amt, type: "pack", verifiedOnly: true },
                          });
                          setGrantResult({ ok: true, msg: `Granted ${res.amount} credits to ${res.recipients}/${res.totalUsers} verified users` });
                          fetchAll();
                        } catch (err: any) {
                          setGrantResult({ ok: false, msg: err.message || "Bulk grant failed" });
                        } finally { setGranting(false); }
                      }}
                    >
                      {granting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gift className="w-3 h-3" />}
                      +{amt} TO ALL
                    </Button>
                  ))}
                  <span className="font-mono-share text-[9px] text-muted-foreground/50">
                    Capped at 1000 per user per call.
                  </span>
                </div>
              </div>
            </section>

            {/* Free Credits Kill Switch */}
            <section className="border border-secondary/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 space-y-3">
              <h2 className="font-orbitron text-xs tracking-wider text-secondary/80 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" />
                FREE_CREDITS_SWITCH
              </h2>
              <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
                Toggle each free-credit source independently. Reddit posting reward is <span className="text-secondary">always on</span> and cannot be disabled here.
              </p>
              {fcLoading ? (
                <div className="font-mono-share text-[10px] text-muted-foreground/60">Loading…</div>
              ) : !fcState ? (
                <div className="space-y-2">
                  <div className="font-mono-share text-[10px] text-destructive">{fcResult?.msg || "Failed to load free-credit state."}</div>
                  <Button variant="outline" size="sm" onClick={fetchFreeCredits} className="font-mono-share text-[10px] h-7 px-2 gap-1">
                    <RefreshCw className="w-3 h-3" /> RETRY
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {fcState.envForcedDisabled && (
                    <div className="font-mono-share text-[10px] px-2 py-1.5 rounded bg-destructive/10 border border-destructive/30 text-destructive">
                      ⚠ FREE_CREDITS_DISABLED env var is set — all sources are forced OFF and UI toggles are ignored. Unset it in the server .env to use these switches.
                    </div>
                  )}
                  <div className="grid gap-2">
                    {([
                      { key: "master", label: "MASTER (default for unset sources)", value: fcState.master, locked: false },
                      { key: "daily", label: "Daily credit refill (cron)", value: fcState.daily, locked: false },
                      { key: "spin", label: "Free spin wheel", value: fcState.spin, locked: false },
                      { key: "missions", label: "Daily missions + streak bonus", value: fcState.missions, locked: false },
                      { key: "starter", label: `Starter grant on email verification (${fcState.starterCredits ?? 15} cr, once per device)`, value: fcState.starter, locked: false },
                      { key: "reddit", label: "Reddit posting reward (always on)", value: true, locked: true },
                    ] as const).map((row) => {
                      const saving = fcSaving === row.key;
                      const disabled = row.locked || saving || fcState.envForcedDisabled;
                      return (
                        <div key={row.key} className="flex items-center justify-between gap-3 border border-border/40 rounded px-3 py-2 bg-background/40">
                          <div className="flex-1 min-w-0">
                            <div className="font-mono-share text-[11px] text-foreground truncate">{row.label}</div>
                            <div className={`font-mono-share text-[9px] ${row.value ? "text-green-400" : "text-amber-400"}`}>
                              {row.value ? "● ENABLED" : "○ DISABLED"}
                              {row.locked && <span className="text-muted-foreground/60 ml-1">(locked)</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              variant="outline" size="sm"
                              disabled={disabled || row.value}
                              className="font-mono-share text-[10px] h-7 px-2 gap-1 border-green-500/40 hover:bg-green-500/10 text-green-400"
                              onClick={() => !row.locked && updateFreeCreditSource(row.key as any, true)}
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "ON"}
                            </Button>
                            <Button
                              variant="outline" size="sm"
                              disabled={disabled || !row.value}
                              className="font-mono-share text-[10px] h-7 px-2 gap-1 border-amber-500/40 hover:bg-amber-500/10 text-amber-400"
                              onClick={() => !row.locked && updateFreeCreditSource(row.key as any, false)}
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "OFF"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" disabled={fcLoading}
                      className="font-mono-share text-xs gap-1.5 text-muted-foreground"
                      onClick={fetchFreeCredits}>
                      REFRESH
                    </Button>
                    <p className="font-mono-share text-[9px] text-muted-foreground/50">
                      Per-source values override MASTER. Reddit posting is permanently on.
                    </p>
                  </div>
                  {fcResult && (
                    <div className={`font-mono-share text-[10px] px-2 py-1.5 rounded ${fcResult.ok ? "bg-green-500/10 text-green-400" : "bg-destructive/10 text-destructive"}`}>
                      {fcResult.msg}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Creator Applications Queue */}
            <section className="border border-secondary/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 space-y-3">
              <h2 className="font-orbitron text-xs tracking-wider text-secondary/80 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" />
                CREATOR_APPLICATIONS
              </h2>
              <div className="flex gap-1 flex-wrap">
                {(["pending", "approved", "rejected"] as const).map((s) => (
                  <Button key={s} size="sm" variant={caStatus === s ? "default" : "outline"}
                    className="font-mono-share text-[10px] h-7 px-2"
                    onClick={() => setCaStatus(s)}>
                    {s.toUpperCase()}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" className="font-mono-share text-[10px] h-7 px-2 ml-auto"
                  onClick={() => fetchCreatorApps(caStatus)}>REFRESH</Button>
              </div>
              {caList === null ? (
                <div className="font-mono-share text-[10px] text-muted-foreground/60">Loading…</div>
              ) : caList.length === 0 ? (
                <div className="font-mono-share text-[10px] text-muted-foreground/60">No {caStatus} applications.</div>
              ) : (
                <div className="space-y-2">
                  {caList.map((a) => (
                    <div key={a.id} className="border border-border/40 rounded p-3 bg-background/40 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-orbitron text-xs">{a.display_name} <span className="text-muted-foreground/60">@{a.handle}</span></div>
                          <div className="font-mono-share text-[10px] text-muted-foreground truncate">{a.email} · {a.country || "—"} · payout: {a.payout_pref}</div>
                        </div>
                        <div className="font-mono-share text-[9px] text-muted-foreground/60 shrink-0">{new Date(a.created_at).toLocaleDateString()}</div>
                      </div>
                      {/* Details row */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono-share text-[10px] text-muted-foreground">
                        {a.niche && <span><span className="text-muted-foreground/50">niche:</span> {a.niche}</span>}
                        {a.languages && <span><span className="text-muted-foreground/50">lang:</span> {a.languages}</span>}
                        <span className={a.age_confirmed ? "text-green-400/80" : "text-destructive"}>
                          {a.age_confirmed ? "✓ 18+ confirmed" : "✗ AGE NOT CONFIRMED"}
                        </span>
                      </div>
                      {/* Full pitch */}
                      <p className="font-mono-share text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap">{a.pitch}</p>
                      {/* Socials */}
                      {a.socials && Object.values(a.socials).some(Boolean) && (
                        <div className="font-mono-share text-[10px] text-secondary/80 flex flex-wrap gap-x-3 gap-y-1">
                          {Object.entries(a.socials).filter(([, v]) => v).map(([k, v]) => (
                            <a key={k} href={String(v)} target="_blank" rel="noopener noreferrer" className="underline capitalize">{k}</a>
                          ))}
                        </div>
                      )}
                      {/* Uploaded sample media */}
                      {Array.isArray(a.sample_urls) && a.sample_urls.length > 0 && (
                        <div>
                          <div className="font-mono-share text-[9px] text-muted-foreground/50 mb-1">SAMPLES ({a.sample_urls.length}) — tap to open full size</div>
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                            {a.sample_urls.map((url, i) => {
                              const isVid = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
                              return (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                  className="block aspect-square rounded overflow-hidden border border-border/40 bg-background/60 hover:border-secondary/60 transition-colors">
                                  {isVid ? (
                                    <video src={url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                  ) : (
                                    <img src={url} alt={`sample ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                                  )}
                                </a>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {caStatus === "pending" && (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" disabled={caBusy === a.id}
                            className="font-mono-share text-[10px] h-7 px-3 bg-green-600 hover:bg-green-500"
                            onClick={() => reviewCreatorApp(a.id, "approve")}>
                            {caBusy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "APPROVE"}
                          </Button>
                          <Button size="sm" variant="outline" disabled={caBusy === a.id}
                            className="font-mono-share text-[10px] h-7 px-3 border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={() => reviewCreatorApp(a.id, "reject")}>
                            REJECT
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Feed Moderators */}
            <section className="border border-secondary/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 space-y-3">
              <h2 className="font-orbitron text-xs tracking-wider text-secondary/80 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" />
                FEED_MODERATORS
              </h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[180px]">
                  <label className="font-mono-share text-[9px] text-muted-foreground/60 block mb-1">EMAIL</label>
                  <input type="email" value={modEmail} onChange={e => setModEmail(e.target.value)} placeholder="user@example.com"
                    className="w-full bg-background/60 border border-border rounded px-2.5 py-1.5 font-mono-share text-xs text-foreground placeholder-muted-foreground/40" />
                </div>
                <Button variant="outline" size="sm" disabled={modAction || !modEmail.trim()}
                  className="font-mono-share text-xs gap-1.5 border-secondary/40 hover:bg-secondary/10 text-secondary"
                  onClick={async () => {
                    setModAction(true); setModResult(null);
                    try {
                      await apiFetch("/admin", { method: "POST", body: { action: "add-mod", email: modEmail.trim() } });
                      setModResult({ ok: true, msg: `${modEmail.trim()} is now a feed moderator` });
                      setModEmail("");
                      fetchMods();
                    } catch (err: any) {
                      setModResult({ ok: false, msg: err.message || "Failed" });
                    } finally { setModAction(false); }
                  }}>
                  {modAction ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                  ADD MOD
                </Button>
              </div>
              {modResult && (
                <div className={`font-mono-share text-[10px] px-2 py-1.5 rounded ${modResult.ok ? "bg-green-500/10 text-green-400" : "bg-destructive/10 text-destructive"}`}>
                  {modResult.msg}
                </div>
              )}
              {modsLoading ? (
                <div className="text-muted-foreground/60 font-mono-share text-xs">Loading...</div>
              ) : mods.length === 0 ? (
                <div className="text-muted-foreground/40 font-mono-share text-xs">No moderators assigned</div>
              ) : (
                <div className="space-y-1">
                  {mods.map((m: any) => (
                    <div key={m.user_id} className="flex items-center justify-between bg-background/40 rounded px-2.5 py-1.5">
                      <div>
                        <span className="font-mono-share text-xs text-foreground">{m.username || m.email}</span>
                        {m.username && <span className="font-mono-share text-[9px] text-muted-foreground/50 ml-2">{m.email}</span>}
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive hover:bg-destructive/10 font-mono-share text-[10px]"
                        onClick={async () => {
                          setModAction(true);
                          try {
                            await apiFetch("/admin", { method: "POST", body: { action: "remove-mod", userId: m.user_id } });
                            fetchMods();
                          } catch (err: any) {
                            setModResult({ ok: false, msg: err.message || "Failed to remove" });
                          } finally { setModAction(false); }
                        }}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
              <div className="px-3 sm:px-4 py-3 border-b border-border/30">
                <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2 flex-wrap">
                  <Users className="w-3.5 h-3.5" />
                  TOP_OPERATORS ({winLabel})
                  <span className="font-mono-share text-[9px] text-muted-foreground/50 tracking-normal normal-case">
                    spend minus what their generations cost to serve
                  </span>
                </h2>
              </div>
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[680px]">
                  <thead><tr className="border-b border-border/20">
                    {["OPERATOR", "TIER", "SPENT", "COST", "MARGIN", "GENS", "USED", "BAL", "LAST"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {topUsers.map((u, i) => (
                      <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                        <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{u.email}</td>
                        <td className="px-2.5 py-2">
                          {u.subscription_tier ? (
                            <span className={`font-orbitron text-[9px] tracking-wider px-2 py-0.5 rounded border ${
                              u.subscription_cancel_at ? "bg-destructive/20 text-destructive border-destructive/30" : "bg-secondary/20 text-secondary border-secondary/30"
                            }`}>{(u.subscription_tier ?? "").toUpperCase()}{u.subscription_cancel_at && " (ending)"}</span>
                          ) : (
                            <span className="font-mono-share text-[10px] text-muted-foreground/40">none</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-secondary" data-numeric>{fmt$(u.total_spent_cents)}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-destructive" data-numeric>{fmt$(u.cost_cents ?? 0)}</td>
                        <td className={`px-2.5 py-2 font-mono-share text-xs font-bold ${(u.margin_cents ?? 0) >= 0 ? "text-green-400" : "text-destructive"}`} data-numeric>
                          {fmt$(u.margin_cents ?? 0)}
                        </td>
                        <td className="px-2.5 py-2 font-mono-share text-xs" data-numeric>{Number(u.total_generations || 0).toLocaleString()}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs" data-numeric>{Number(u.total_credits_used || 0).toLocaleString()}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-primary" data-numeric>{(u.sub_credits + u.pack_credits).toLocaleString()}</td>
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/50">
                          {u.last_generation ? new Date(u.last_generation).toLocaleDateString() : "never"}
                        </td>
                      </tr>
                    ))}
                    {topUsers.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center font-mono-share text-xs text-muted-foreground/40">No operator data in this window.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="px-3 sm:px-4 py-3 border-t border-border/20 font-mono-share text-[10px] text-muted-foreground/50">
                SPENT is purchases inside the window, not lifetime — a negative margin here means that user cost more to
                serve than they paid over this period, which for a subscriber on an annual plan is expected mid-term.
              </p>
            </section>

            {/* ── USER INSPECTOR ── */}
            <section className="border border-primary/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
              <div className="px-3 sm:px-4 py-3 border-b border-primary/20">
                <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5" />
                  USER_INSPECTOR
                </h2>
              </div>
              <div className="p-3 sm:p-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    className="bg-background/60 border border-border rounded px-2.5 py-1.5 font-mono-share text-xs text-foreground flex-1 min-w-[180px]"
                    placeholder="user@email.com"
                    value={inspectEmail}
                    onChange={(e) => setInspectEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && inspectEmail.trim() && handleInspect()}
                  />
                  <button
                    className="px-3 py-1.5 bg-primary text-primary-foreground font-mono-share text-xs rounded hover:bg-primary/80 disabled:opacity-50"
                    disabled={inspecting || !inspectEmail.trim()}
                    onClick={handleInspect}
                  >
                    {inspecting ? "..." : "INSPECT"}
                  </button>
                </div>

                {inspectData && (
                  <div className="space-y-3">
                    {/* User header */}
                    <div className="flex items-center justify-between gap-2 p-3 bg-background/30 rounded border border-border/20">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-orbitron text-sm text-foreground">@{inspectData.user.username || "—"}</span>
                          <span className="font-mono-share text-[10px] text-muted-foreground">{inspectData.user.email}</span>
                          {inspectData.ban && (
                            <span className="px-1.5 py-0.5 bg-destructive/20 text-destructive font-mono-share text-[9px] rounded">BANNED</span>
                          )}
                          {inspectData.user.verification_status === "verified" && (
                            <span className="px-1.5 py-0.5 bg-primary/20 text-primary font-mono-share text-[9px] rounded">✓ VERIFIED</span>
                          )}
                        </div>
                        <div className="font-mono-share text-[10px] text-muted-foreground/60 flex gap-3 mt-1">
                          <span>Tier: {inspectData.user.subscription_tier || "free"}</span>
                          <span>Credits: {(inspectData.user.daily_credits || 0) + (inspectData.user.sub_credits || 0) + (inspectData.user.pack_credits || 0)}</span>
                          <span>Flags: <span className={inspectData.moderationFlags > 0 ? "text-destructive" : ""}>{inspectData.moderationFlags}</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {inspectData.user.verification_status === "verified" ? (
                          <button
                            className="px-3 py-1 bg-muted text-muted-foreground font-mono-share text-[10px] rounded hover:bg-muted/80"
                            onClick={async () => {
                              if (!confirm(`Revoke verification for ${inspectData.user.email}?`)) return;
                              try {
                                await apiFetch("/admin", { method: "POST", body: { action: "revoke-verification", userId: inspectData.user.id } });
                                handleInspect();
                              } catch (err: any) { alert(err.message); }
                            }}
                          >
                            UNVERIFY
                          </button>
                        ) : (
                          <button
                            className="px-3 py-1 bg-primary text-primary-foreground font-mono-share text-[10px] rounded hover:bg-primary/80"
                            onClick={async () => {
                              const days = prompt("Verification duration (days):", "365");
                              if (days === null) return;
                              try {
                                await apiFetch("/admin", { method: "POST", body: { action: "grant-verification", userId: inspectData.user.id, durationDays: Number(days) || 365 } });
                                handleInspect();
                              } catch (err: any) { alert(err.message); }
                            }}
                          >
                            ✓ VERIFY
                          </button>
                        )}
                        {!inspectData.ban ? (
                          <button
                            className="px-3 py-1 bg-destructive text-destructive-foreground font-mono-share text-[10px] rounded hover:bg-destructive/80 disabled:opacity-50"
                            disabled={banning}
                            onClick={async () => {
                              const duration = prompt("Ban duration (1h, 24h, 7d, 30d, or empty for permanent):", "24h");
                              if (duration === null) return;
                              const reason = prompt("Ban reason:", "Violation of community guidelines");
                              if (reason === null) return;
                              setBanning(true);
                              try {
                                const d = duration.trim().toLowerCase();
                                await apiFetch("/admin", { method: "POST", body: { action: "ban-user", userId: inspectData.user.id, reason, duration: d || undefined } });
                                handleInspect();
                                fetchBans();
                              } catch (err: any) { alert(err.message); }
                              finally { setBanning(false); }
                            }}
                          >
                            <Ban className="w-3 h-3 inline mr-1" />BAN
                          </button>
                        ) : (
                          <button
                            className="px-3 py-1 bg-green-600/80 text-white font-mono-share text-[10px] rounded hover:bg-green-500"
                            onClick={async () => {
                              try {
                                await apiFetch("/admin", { method: "POST", body: { action: "unban-user", userId: inspectData.user.id } });
                                handleInspect();
                                fetchBans();
                              } catch (e: any) {
                                alert(e?.message || "Unban failed");
                              }
                            }}
                          >
                            UNBAN
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Sub-tabs */}
                    <div className="flex gap-1 border-b border-border/20">
                      {(["prompts", "posts", "stories"] as const).map((t) => (
                        <button key={t} onClick={() => setInspectTab(t)}
                          className={`px-3 py-1.5 font-mono-share text-[10px] tracking-wider border-b-2 transition-colors ${inspectTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground/50 hover:text-muted-foreground"}`}
                        >
                          {t.toUpperCase()} ({t === "prompts" ? inspectData.prompts.length : t === "posts" ? inspectData.posts.length : inspectData.stories.length})
                        </button>
                      ))}
                    </div>

                    {/* Prompts */}
                    {inspectTab === "prompts" && (
                      <div className="max-h-[400px] overflow-y-auto space-y-1">
                        {inspectData.prompts.length === 0 ? (
                          <p className="font-mono-share text-xs text-muted-foreground/40 py-4 text-center">No prompts</p>
                        ) : inspectData.prompts.map((p: any, i: number) => (
                          <div key={i} className="flex gap-2 items-start py-1.5 px-2 rounded hover:bg-primary/5 border-b border-border/10">
                            <span className={`font-mono-share text-[9px] px-1.5 py-0.5 rounded shrink-0 ${p.mode?.includes("moderation") ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary/70"}`}>
                              {p.mode?.toUpperCase()}
                            </span>
                            <span className="font-mono-share text-xs text-foreground/80 flex-1 break-all">{p.prompt || "—"}</span>
                            <span className="font-mono-share text-[9px] text-muted-foreground/40 shrink-0">
                              {p.credits_used}cr {p.api_cost_cents ? `/ ${p.api_cost_cents}¢` : ""}
                            </span>
                            <span className="font-mono-share text-[9px] text-muted-foreground/30 shrink-0">
                              {new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Posts */}
                    {inspectTab === "posts" && (
                      <div className="max-h-[400px] overflow-y-auto space-y-2">
                        {inspectData.posts.length === 0 ? (
                          <p className="font-mono-share text-xs text-muted-foreground/40 py-4 text-center">No posts</p>
                        ) : inspectData.posts.map((p: any) => (
                          <div key={p.id} className="p-2 rounded border border-border/20 hover:bg-primary/5 space-y-1">
                            <p className="font-mono-share text-xs text-foreground/80">{p.text || "—"}</p>
                            {p.image_url && (
                              <img src={p.image_url} alt="" className="w-24 h-24 object-cover rounded border border-border/20" />
                            )}
                            <span className="font-mono-share text-[9px] text-muted-foreground/40 block">
                              {new Date(p.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Stories */}
                    {inspectTab === "stories" && (
                      <div className="max-h-[400px] overflow-y-auto space-y-2">
                        {inspectData.stories.length === 0 ? (
                          <p className="font-mono-share text-xs text-muted-foreground/40 py-4 text-center">No stories</p>
                        ) : inspectData.stories.map((s: any) => (
                          <div key={s.id} className="p-2 rounded border border-border/20 hover:bg-primary/5 flex gap-3">
                            {s.media_type === "video" ? (
                              <video src={s.media_url} className="w-24 h-24 object-cover rounded border border-border/20" muted playsInline />
                            ) : (
                              <img src={s.media_url} alt="" className="w-24 h-24 object-cover rounded border border-border/20" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="font-mono-share text-xs text-foreground/80">{s.caption || s.prompt || "—"}</p>
                              <span className="font-mono-share text-[9px] text-muted-foreground/40">
                                {new Date(s.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                {s.expires_at && new Date(s.expires_at) > new Date() && " · active"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {/* ═══ USAGE TAB ═══ */}
        {activeTab === "usage" && (
          <>
            {/*
              Series are derived from whatever the window actually contains.
              The old chart hardcoded generate-image / edit-image /
              generate-video — all three retired in April 2026 when generation
              moved to RunPod — so it had been rendering an empty plot ever
              since.
            */}
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5" />
                  GENERATION_VOLUME
                </h2>
                <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                  <ChartToggle active={usageMetric === "count"} onClick={() => setUsageMetric("count")} title="Count generations">GENS</ChartToggle>
                  <ChartToggle active={usageMetric === "credits"} onClick={() => setUsageMetric("credits")} title="Count credits consumed">CREDITS</ChartToggle>
                  <span className="w-px h-4 bg-border/40 mx-0.5" />
                  <ChartToggle active={usageStacked} onClick={() => setUsageStacked((v) => !v)} title="Stack modes into one bar per bucket">STACKED</ChartToggle>
                  <select
                    value={usageTopN}
                    onChange={(e) => setUsageTopN(Number(e.target.value))}
                    className="bg-card/60 border border-border/30 rounded px-1.5 py-1 font-mono-share text-[10px] text-foreground/80"
                    title="How many modes to show before folding the rest into OTHER"
                  >
                    {[3, 4, 6, 8].map((n) => <option key={n} value={n}>TOP {n}</option>)}
                  </select>
                </div>
              </div>
              <RangeControl value={range} onChange={setRange} className="mb-3" />
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={usagePivot}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmtCompact} width={42} />
                  <Tooltip content={<CyberTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 9, fontFamily: "var(--font-mono-share)" }} />
                  {usageModes.map((mode, i) => (
                    <Bar
                      key={mode}
                      dataKey={mode}
                      name={mode}
                      stackId={usageStacked ? "a" : undefined}
                      fill={mode === "OTHER" ? "hsl(var(--muted-foreground))" : SERIES_COLORS[i % SERIES_COLORS.length]}
                      fillOpacity={0.8}
                    />
                  ))}
                  {usagePivot.length > 24 && (
                    <Brush dataKey="day" height={18} travellerWidth={8} stroke="hsl(var(--primary))" fill="hsl(var(--card))" />
                  )}
                </BarChart>
              </ResponsiveContainer>
              {usagePivot.length === 0 && (
                <p className="font-mono-share text-[10px] text-muted-foreground/40 text-center py-6">no generations in this window</p>
              )}
            </div>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard icon={<Activity className="w-4 h-4" />} label="CREDITS_OUTSTANDING" value={fmtCompact(o.creditPool.total_sub_credits_outstanding + o.creditPool.total_pack_credits_outstanding)} sub={`${o.creditPool.total_sub_credits_outstanding.toLocaleString()} sub + ${o.creditPool.total_pack_credits_outstanding.toLocaleString()} pack`} />
              <KpiCard icon={<Zap className="w-4 h-4" />} label={`CREDITS_${winLabel}`} value={o.usage.credits_window.toLocaleString()} sub={`${o.usage.generations_window.toLocaleString()} generations`} />
              <KpiCard icon={<Zap className="w-4 h-4" />} label="TOTAL_GENERATIONS" value={fmtCompact(o.usage.total_generations)} sub={`${fmtCompact(o.usage.total_credits_used)} credits all-time`} />
              <KpiCard icon={<Server className="w-4 h-4" />} label={`GPU_COST_${winLabel}`} value={fmt$(runpodCost)} sub={`${fmtPct(o.cost.coverage)} measured`} accent="destructive" />
            </section>

            {profitBreakdown.length > 0 && (
              <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
                <div className="px-3 sm:px-4 py-3 border-b border-border/30">
                  <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2 flex-wrap">
                    <BarChart3 className="w-3.5 h-3.5" />
                    UNIT_ECONOMICS ({winLabel})
                    <span className="font-mono-share text-[9px] text-muted-foreground/50 tracking-normal normal-case">
                      revenue attributed @ {centsPerCredit.toFixed(2)}¢/credit realized in this window
                    </span>
                  </h2>
                </div>
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[780px]">
                    <thead><tr className="border-b border-border/20">
                      {["MODE", "VENDOR", "GENS", "CREDITS", "AVG CR", "AVG TIME", "COST", "¢/GEN", "MEASURED", "EST. REV", "MARGIN"].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {profitBreakdown.map((row: any, i: number) => {
                        const avgCr = row.generations > 0 ? (row.credits_used / row.generations).toFixed(1) : "—";
                        const marginPct = row.revenue_cents > 0 ? row.margin_pct : null;
                        return (
                          <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                            <td className="px-2.5 py-2 font-orbitron text-[10px] tracking-wider text-foreground/80">
                              {row.mode?.toUpperCase()}
                              {row.refunded > 0 && (
                                <span className="ml-1.5 font-mono-share text-[8px] text-destructive/70" title={`${row.refunded} refunded, ${row.refunded_credits} credits returned — still cost GPU time`}>
                                  ↩{row.refunded}
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-[9px] text-muted-foreground/60">{row.provider}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs" data-numeric>{row.generations.toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-primary font-bold" data-numeric>{row.credits_used.toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs" data-numeric>{avgCr}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs" data-numeric>{row.avg_exec_sec > 0 ? `${row.avg_exec_sec.toFixed(1)}s` : "—"}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-destructive" data-numeric>{fmt$(Math.round(row.blended_cost_cents))}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-destructive/70" data-numeric>{row.cost_per_generation.toFixed(2)}¢</td>
                            <td className="px-2.5 py-2 font-mono-share text-[10px]" data-numeric
                                title={`${row.cost_tracked_count} of ${row.generations + row.refunded} rows carry a real cost; the rest use this mode's observed average`}>
                              <span className={row.cost_coverage >= 0.8 ? "text-secondary" : row.cost_coverage >= 0.4 ? "text-amber-400" : "text-muted-foreground/50"}>
                                {fmtPct(row.cost_coverage)}
                              </span>
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-secondary" data-numeric>{fmt$(Math.round(row.revenue_cents))}</td>
                            <td className={`px-2.5 py-2 font-mono-share text-xs font-bold ${marginPct !== null && marginPct >= 0 ? "text-green-400" : "text-destructive"}`} data-numeric>
                              {marginPct !== null ? fmtPct(marginPct) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="px-3 sm:px-4 py-3 border-t border-border/20 font-mono-share text-[10px] text-muted-foreground/50 leading-relaxed">
                  Refunded jobs are excluded from credits and revenue but kept in cost — the GPU still ran. MEASURED is the
                  share of rows carrying a real reported execution cost; the remainder is priced at that mode's own observed
                  average rather than dropped to zero.
                </p>
              </section>
            )}
          </>
        )}

        {/* ═══ MODERATION TAB ═══ */}
        {activeTab === "moderation" && o.moderation && (
          <section className="border border-red-500/30 rounded-lg bg-red-950/10 backdrop-blur-sm overflow-hidden">
            <div className="px-3 sm:px-4 py-3 border-b border-red-500/20 flex items-center justify-between">
              <h2 className="font-orbitron text-xs tracking-wider text-red-400 flex items-center gap-2">
                <ShieldX className="w-3.5 h-3.5" />
                MODERATION_DEFENSE
              </h2>
              <span className="font-mono-share text-[9px] text-red-400/60">
                xAI charges for flagged requests — credits not refunded
              </span>
            </div>
            <div className="p-3 sm:p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                <KpiCard icon={<Ban className="w-4 h-4" />} label={`FLAGGED_${winLabel}`} value={o.moderation.blocks_window} sub={`${o.moderation.blocks_today} today // ${o.moderation.total_blocks} total`} accent="destructive" />
                <KpiCard icon={<Flame className="w-4 h-4" />} label={`CREDITS_BURNED_${winLabel}`} value={o.moderation.credits_burned_window} sub={`${o.moderation.total_credits_burned} lifetime (not refunded)`} accent="destructive" />
                <KpiCard icon={<CreditCard className="w-4 h-4" />} label={`xAI_WASTE_${winLabel}`} value={fmt$(o.moderation.wasted_cost_window_cents)} sub={`${fmt$(o.moderation.wasted_cost_total_cents)} lifetime — already counted inside xAI cost, not added on top`} accent="destructive" />
              </div>
              {o.moderation.offenders && o.moderation.offenders.length > 0 && (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[400px]">
                    <thead><tr className="border-b border-red-500/20">
                      {["USER", "FLAGS", "CREDITS", "LAST", ""].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-red-400/50 tracking-wider">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {o.moderation.offenders.map((off, i) => {
                        const isBanned = bans.some((b: any) => b.email === off.email);
                        return (
                        <tr key={i} className="border-b border-red-500/10 hover:bg-red-500/5 transition-colors">
                          <td className="px-2.5 py-2 font-mono-share text-xs text-primary/80 underline underline-offset-2 cursor-pointer hover:text-primary transition-colors"
                            onClick={() => { setInspectEmail(off.email); setActiveTab("users"); inspectByEmail(off.email); }}
                            title="Inspect user"
                          >{off.email}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-red-400 font-bold">{off.block_count}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-red-400">{off.credits_burned}</td>
                          <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/50">
                            {off.last_block ? new Date(off.last_block).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td className="px-2.5 py-2">
                            {isBanned ? (
                              <span className="font-mono-share text-[9px] text-red-400/60 tracking-wider">BANNED</span>
                            ) : (
                              <button
                                className="px-2 py-0.5 bg-red-600 text-white font-mono-share text-[10px] rounded hover:bg-red-500 disabled:opacity-50 flex items-center gap-1"
                                disabled={banning}
                                onClick={async () => {
                                  if (!confirm(`Ban ${off.email}? They will be blocked from all generation, feed posts, and stories.`)) return;
                                  setBanning(true);
                                  try {
                                    await apiFetch("/admin", { method: "POST", body: { action: "ban-user", email: off.email, reason: `Repeat safety violations (${off.block_count} flags)` } });
                                    fetchBans();
                                  } catch (err: any) {
                                    alert(err.message);
                                  } finally {
                                    setBanning(false);
                                  }
                                }}
                              >
                                <Ban className="w-3 h-3" /> BAN
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── BAN MANAGEMENT ── */}
              <div className="border-t border-red-500/20 pt-3 space-y-3">
                <h3 className="font-orbitron text-[10px] tracking-wider text-red-400/80">BAN_MANAGEMENT</h3>
                <div className="flex gap-2 flex-wrap">
                  <input
                    className="bg-background/50 border border-red-500/30 rounded px-2 py-1 font-mono-share text-xs text-foreground flex-1 min-w-[150px]"
                    placeholder="user@email.com"
                    value={banEmail}
                    onChange={(e) => setBanEmail(e.target.value)}
                  />
                  <input
                    className="bg-background/50 border border-red-500/30 rounded px-2 py-1 font-mono-share text-xs text-foreground flex-1 min-w-[120px]"
                    placeholder="Reason (optional)"
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                  />
                  <select
                    className="bg-background/50 border border-red-500/30 rounded px-2 py-1 font-mono-share text-xs text-foreground"
                    value={banDuration}
                    onChange={(e) => setBanDuration(e.target.value)}
                  >
                    <option value="1h">1 HOUR</option>
                    <option value="24h">24 HOURS</option>
                    <option value="7d">7 DAYS</option>
                    <option value="30d">30 DAYS</option>
                    <option value="permanent">PERMANENT</option>
                  </select>
                  <button
                    className="px-3 py-1 bg-red-600 text-white font-mono-share text-xs rounded hover:bg-red-500 disabled:opacity-50"
                    disabled={banning || !banEmail.trim()}
                    onClick={handleBan}
                  >
                    {banning ? "..." : "BAN"}
                  </button>
                </div>

                {bansLoading ? (
                  <p className="font-mono-share text-xs text-muted-foreground">Loading bans...</p>
                ) : bans.length === 0 ? (
                  <p className="font-mono-share text-xs text-muted-foreground/50">No banned users</p>
                ) : (
                  <div className="overflow-x-auto overscroll-x-contain">
                    <table className="w-full min-w-[400px]">
                      <thead><tr className="border-b border-red-500/20">
                        {["EMAIL", "REASON", "EXPIRES", "DATE", ""].map((h) => (
                          <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-red-400/50 tracking-wider">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {bans.map((b: any) => {
                          const expired = b.expires_at && new Date(b.expires_at) <= new Date();
                          return (
                            <tr key={b.user_id} className={`border-b border-red-500/10 hover:bg-red-500/5 transition-colors ${expired ? "opacity-40" : ""}`}>
                              <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{b.email}</td>
                              <td className="px-2.5 py-2 font-mono-share text-xs text-red-400">{b.reason}</td>
                              <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/50">
                                {b.expires_at
                                  ? (expired ? "EXPIRED" : new Date(b.expires_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))
                                  : "PERMANENT"}
                              </td>
                              <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/50">
                                {new Date(b.created_at).toLocaleString("en-US", { month: "short", day: "numeric" })}
                              </td>
                              <td className="px-2.5 py-2">
                                <button
                                  className="px-2 py-0.5 bg-green-600/80 text-white font-mono-share text-[10px] rounded hover:bg-green-500"
                                  onClick={() => handleUnban(b.user_id)}
                                >
                                  UNBAN
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ═══ CHAT MODERATION ═══ */}
        {activeTab === "moderation" && <AdminChatModerationPanel />}

        {/* ═══ CREDIT FARMERS ═══ */}
        {activeTab === "farmers" && <AdminFarmersPanel />}

        {/* ═══ REFERRALS TAB ═══ */}
        {activeTab === "referrals" && referralStats && (
          <section className="border border-green-500/30 rounded-lg bg-green-950/10 backdrop-blur-sm overflow-hidden">
            <div className="px-3 sm:px-4 py-3 border-b border-green-500/20 flex items-center justify-between">
              <h2 className="font-orbitron text-xs tracking-wider text-green-400 flex items-center gap-2">
                <Share2 className="w-3.5 h-3.5" />
                REFERRAL_PROGRAM
              </h2>
              <span className="font-mono-share text-[9px] text-green-400/60">
                {referralStats.conversionRate}% conversion rate
              </span>
            </div>
            <div className="p-3 sm:p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
                <KpiCard icon={<Share2 className="w-4 h-4" />} label="TOTAL_REFERRALS" value={referralStats.total_referrals} sub={`${referralStats.verified} verified`} accent="secondary" />
                <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="CONVERTED" value={referralStats.converted} sub={`${referralStats.conversionRate}% of referrals purchased`} accent="secondary" />
                <KpiCard icon={<DollarSign className="w-4 h-4" />} label="REVENUE" value={`$${((referralStats.attributedRevenueCents || 0) / 100).toFixed(0)}`} sub={`${referralStats.payingReferees || 0} paying referees, lifetime`} accent="secondary" />
                <KpiCard icon={<Gift className="w-4 h-4" />} label="CREDITS_GRANTED" value={referralStats.creditsGranted} sub="total referral credits given" accent="secondary" />
                <KpiCard icon={<Crown className="w-4 h-4" />} label="REWARDS_PAID" value={referralStats.rewarded} sub="referrers who earned 10 cr" accent="secondary" />
              </div>
              {referralStats.topReferrers && referralStats.topReferrers.length > 0 && (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[460px]">
                    <thead><tr className="border-b border-green-500/20">
                      {["REFERRER", "REFERRED", "CONVERTED", "REVENUE", "REWARDS"].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-green-400/50 tracking-wider">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {referralStats.topReferrers.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-green-500/10 hover:bg-green-500/5 transition-colors">
                          <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{r.email}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-green-400 font-bold">{r.referral_count}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-green-400">{r.conversions}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-secondary font-bold">${((r.revenue_cents || 0) / 100).toFixed(2)}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-secondary">{r.rewards}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {referralStats.recentSignups && referralStats.recentSignups.length > 0 && (
                <div>
                  <h3 className="font-mono-share text-[10px] text-green-400/60 tracking-wider mb-1.5 mt-2">RECENT_REFERRED_SIGNUPS</h3>
                  <div className="overflow-x-auto overscroll-x-contain">
                    <table className="w-full min-w-[560px]">
                      <thead><tr className="border-b border-green-500/20">
                        {["SIGNED UP", "REFERRED BY", "DATE", "STATUS", "SPENT"].map((h) => (
                          <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-green-400/50 tracking-wider">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {referralStats.recentSignups.map((r: any, i: number) => (
                          <tr key={i} className="border-b border-green-500/10 hover:bg-green-500/5 transition-colors">
                            <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{r.referee_email}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/60">{r.referrer_email}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-green-400/70">{new Date(r.created_at).toLocaleDateString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-[10px]">
                              {r.referee_purchased ? <span className="text-secondary">PURCHASED</span>
                                : r.referee_verified ? <span className="text-green-400">VERIFIED</span>
                                : <span className="text-foreground/40">UNVERIFIED</span>}
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-secondary font-bold">{r.spend_cents > 0 ? `$${(r.spend_cents / 100).toFixed(2)}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ═══ EMAILS TAB ═══ */}
        {activeTab === "emails" && (
          <section className="space-y-4">
            {/* KPI cards */}
            {emailStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                <KpiCard icon={<Mail className="w-4 h-4" />} label="TOTAL_EMAILS" value={emailStats.total} sub={`${emailStats.last_24h} in last 24h`} />
                <KpiCard icon={<Zap className="w-4 h-4" />} label="SENT" value={emailStats.sent} sub={`${emailStats.total > 0 ? Math.round((emailStats.sent / emailStats.total) * 100) : 0}% success rate`} accent="secondary" />
                <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="FAILED" value={emailStats.failed} sub={`${emailStats.failed_24h} in last 24h`} accent="destructive" />
                <KpiCard icon={<Ban className="w-4 h-4" />} label="FAIL_RATE" value={`${emailStats.total > 0 ? ((emailStats.failed / emailStats.total) * 100).toFixed(1) : 0}%`} sub="lifetime failure rate" accent={emailStats.failed > 0 ? "destructive" : "primary"} />
              </div>
            )}

            {/* ── Mass Announcement ── */}
            <AnnouncementPanel />

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={emailFilter.type || ""}
                onChange={(e) => {
                  const f = { ...emailFilter, type: e.target.value || undefined };
                  setEmailFilter(f);
                  fetchEmailLogs(f);
                }}
                className="bg-card/60 border border-border/30 rounded px-2 py-1.5 font-mono-share text-xs text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="">ALL TYPES</option>
                <option value="verification">VERIFICATION</option>
                <option value="password_reset">PASSWORD RESET</option>
                <option value="daily_credits">DAILY CREDITS</option>
                <option value="webhook">WEBHOOK</option>
              </select>
              <select
                value={emailFilter.status || ""}
                onChange={(e) => {
                  const f = { ...emailFilter, status: e.target.value || undefined };
                  setEmailFilter(f);
                  fetchEmailLogs(f);
                }}
                className="bg-card/60 border border-border/30 rounded px-2 py-1.5 font-mono-share text-xs text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="">ALL STATUS</option>
                <option value="sent">SENT</option>
                <option value="failed">FAILED</option>
                <option value="delivered">DELIVERED</option>
                <option value="bounced">BOUNCED</option>
                <option value="complained">COMPLAINED</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchEmailLogs(emailFilter)}
                disabled={emailLoading}
                className="font-mono-share text-xs gap-1.5 border-primary/30 hover:bg-primary/10"
              >
                {emailLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                REFRESH
              </Button>
              {/* Bulk delete: removes failed rows for the currently-filtered
                  campaign so a re-send retries those recipients. Only enabled
                  when the user has filtered by a specific campaign type. */}
              <Button
                variant="outline"
                size="sm"
                disabled={!emailFilter.type || emailLoading}
                onClick={() => deleteFailedEmails(
                  { campaign: emailFilter.type, scope: "all-non-sent" },
                  `Delete ALL non-'sent' email log rows for campaign "${emailFilter.type}"?\n\nThis lets you re-send to recipients whose previous attempt failed/bounced. 'Sent' rows are kept so users don't get duplicates.`,
                )}
                title={emailFilter.type ? `Delete failed rows for ${emailFilter.type}` : "Pick a TYPE filter first"}
                className="font-mono-share text-xs gap-1.5 border-destructive/30 hover:bg-destructive/10 text-destructive"
              >
                <Ban className="w-3 h-3" />
                DELETE_FAILED
              </Button>
            </div>

            {/* Log table */}
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border/20">
                      {["TIME", "RECIPIENT", "TYPE", "STATUS", "RESEND_ID", "ERROR", ""].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {emailLogs.length === 0 && !emailLoading && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center font-mono-share text-xs text-muted-foreground/50">No email logs found</td></tr>
                    )}
                    {emailLoading && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" /></td></tr>
                    )}
                    {emailLogs.map((log: any, i: number) => (
                      <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/60 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80 max-w-[180px] truncate">{log.recipient}</td>
                        <td className="px-2.5 py-2">
                          <span className={`font-orbitron text-[9px] tracking-wider px-2 py-0.5 rounded border ${
                            log.email_type === "verification" ? "bg-primary/20 text-primary border-primary/30"
                            : log.email_type === "password_reset" ? "bg-secondary/20 text-secondary border-secondary/30"
                            : log.email_type === "daily_credits" ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-muted/20 text-muted-foreground border-border/30"
                          }`}>{log.email_type?.toUpperCase()}</span>
                        </td>
                        <td className="px-2.5 py-2">
                          <span className={`font-mono-share text-[10px] font-bold px-2 py-0.5 rounded ${
                            log.status === "sent" || log.status === "delivered" ? "bg-green-500/20 text-green-400"
                            : log.status === "failed" ? "bg-destructive/20 text-destructive"
                            : log.status === "bounced" ? "bg-orange-500/20 text-orange-400"
                            : log.status === "complained" ? "bg-red-500/20 text-red-400"
                            : "bg-muted/20 text-muted-foreground"
                          }`}>{log.status?.toUpperCase()}</span>
                        </td>
                        <td className="px-2.5 py-2 font-mono-share text-[9px] text-muted-foreground/40 max-w-[120px] truncate">{log.resend_id || "—"}</td>
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-destructive/80 max-w-[200px] truncate">{log.error_message || "—"}</td>
                        <td className="px-2.5 py-2 text-right">
                          {log.status !== "sent" && log.status !== "delivered" ? (
                            <button
                              onClick={() => deleteFailedEmails(
                                { ids: [log.id] },
                                `Delete this ${log.status} log row for ${log.recipient}?\n\nNext time you re-send "${log.email_type}" they will be retried.`,
                              )}
                              className="font-mono-share text-[10px] text-destructive/70 hover:text-destructive hover:underline"
                              title="Delete this failed log row"
                            >
                              DEL
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ═══════ API ANALYTICS TAB ═══════ */}
        {activeTab === "api" && (
          <div className="space-y-4">
            {apiAnalyticsLoading && !apiAnalytics && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            )}

            {apiAnalyticsError && !apiAnalytics && (
              <div className="text-center py-12 space-y-3">
                <p className="font-mono-share text-xs text-destructive">{apiAnalyticsError}</p>
                <Button variant="outline" size="sm" onClick={fetchApiAnalytics} className="font-mono-share text-xs gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> RETRY
                </Button>
              </div>
            )}

            {apiAnalytics && (
              <>
                <RangeControl value={range} onChange={setRange} />

                {/* KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
                  <KpiCard icon={<Users className="w-3.5 h-3.5" />} label="API USERS" value={apiAnalytics.kpis?.total_api_users || 0} sub={`${apiAnalytics.kpis?.active_keys || 0} active keys`} />
                  <KpiCard icon={<Zap className="w-3.5 h-3.5" />} label="TOTAL REQUESTS" value={Number(apiAnalytics.kpis?.total_requests || 0).toLocaleString()} sub="lifetime, from key counters" />
                  <KpiCard icon={<CreditCard className="w-3.5 h-3.5" />} label="CREDITS VIA API" value={Number(apiAnalytics.kpis?.total_credits_used || 0).toLocaleString()} sub="lifetime" />
                  <KpiCard icon={<TrendingUp className="w-3.5 h-3.5" />} label={`${winLabel} CREDITS`} value={(apiAnalytics.apiRevenue?.credits_window ?? 0).toLocaleString()} sub={`7d: ${apiAnalytics.apiRevenue?.credits_7d || 0} // today: ${apiAnalytics.apiRevenue?.credits_today || 0}`} />
                  <KpiCard icon={<DollarSign className="w-3.5 h-3.5" />} label={`EST. API REV (${winLabel})`} value={fmt$(apiAnalytics.impliedRevenueCents ?? 0)} sub={`@ ${(apiAnalytics.centsPerCredit ?? centsPerCredit).toFixed(2)}¢/credit realized`} accent="secondary" />
                </div>

                {/* Daily Volume Chart */}
                {apiAnalytics.dailyVolume?.length > 0 && (
                  <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="w-3.5 h-3.5 text-primary" />
                      <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">API_VOLUME ({winLabel})</span>
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <AreaChart data={apiAnalytics.dailyVolume.map((r: any) => ({ ...r, day: fmtBucket(r.day, apiAnalytics.range?.bucket || "day") }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.2} />
                        <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmtCompact} width={42} />
                        <Tooltip content={<CyberTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Area type="monotone" dataKey="requests" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} name="Requests" />
                        <Area type="monotone" dataKey="credits" stroke="hsl(var(--secondary))" fill="hsl(var(--secondary))" fillOpacity={0.1} strokeWidth={2} name="Credits" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </section>
                )}

                {/* Usage by Action */}
                {apiAnalytics.byAction?.length > 0 && (
                  <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="w-3.5 h-3.5 text-primary" />
                      <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">USAGE_BY_ACTION (30D)</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-border/20">
                            <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50">ACTION</th>
                            <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">REQUESTS</th>
                            <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">CREDITS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiAnalytics.byAction.map((row: any, i: number) => (
                            <tr key={i} className="border-b border-border/10">
                              <td className="px-2.5 py-2 font-mono-share text-xs text-primary">{row.action}</td>
                              <td className="px-2.5 py-2 font-mono-share text-xs text-right">{row.count}</td>
                              <td className="px-2.5 py-2 font-mono-share text-xs text-right text-secondary">{row.credits}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* Top API Consumers */}
                <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Crown className="w-3.5 h-3.5 text-secondary" />
                      <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">TOP_API_CONSUMERS</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchApiAnalytics} disabled={apiAnalyticsLoading}
                      className="font-mono-share text-xs gap-1.5">
                      {apiAnalyticsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      REFRESH
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-border/20">
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50">USER</th>
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50">KEY</th>
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">{winLabel} REQ</th>
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">{winLabel} CREDITS</th>
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">LIFETIME</th>
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">LAST USED</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(apiAnalytics.topConsumers || []).map((c: any, i: number) => (
                          <tr key={i} className="border-b border-border/10">
                            <td className="px-2.5 py-2 font-mono-share text-[10px] text-foreground/80 max-w-[160px] truncate">{c.email}</td>
                            <td className="px-2.5 py-2 font-mono-share text-[9px] text-muted-foreground/60">
                              {c.key_prefix} <span className="text-primary/50">({c.key_name})</span>
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-right" data-numeric>{(c.window_requests || 0).toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-right text-secondary" data-numeric>{(c.window_credits || 0).toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-[10px] text-right text-muted-foreground/60" data-numeric>
                              {Number(c.total_credits || 0).toLocaleString()} cr
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-[9px] text-muted-foreground/40 text-right">
                              {c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : "never"}
                            </td>
                          </tr>
                        ))}
                        {(!apiAnalytics.topConsumers || apiAnalytics.topConsumers.length === 0) && (
                          <tr>
                            <td colSpan={6} className="px-2.5 py-4 text-center font-mono-share text-xs text-muted-foreground/40">
                              No API keys created yet
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {activeTab === "flash-sales" && <FlashSalesPanel />}

        {activeTab === "payouts" && <PayoutsPanel />}
        {activeTab === "legacy-subs" && <LegacySubReconcilePanel />}

        {activeTab === "system" && (
          <div className="space-y-4">
          {/* ── RunPod Worker Status ── */}
          <WorkerStatusPanel />

          {/* ── Subscription Sync ── */}
          <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Crown className="w-3.5 h-3.5 text-secondary" />
                <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">SUBSCRIPTION_SYNC</span>
                <span className="font-mono-share text-[9px] text-muted-foreground/40">
                  Pull cancellation status from Stripe for all active subscribers
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={syncSubscriptions}
                disabled={syncing}
                className="font-mono-share text-xs gap-1.5 border-secondary/30 hover:bg-secondary/10"
              >
                {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {syncing ? "SYNCING..." : "SYNC_NOW"}
              </Button>
            </div>
            {syncResult && (
              <div className="mt-3 space-y-2">
                {syncResult.error ? (
                  <p className="font-mono-share text-xs text-destructive">{syncResult.error}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-3 font-mono-share text-[10px] text-muted-foreground/70">
                      <span>Checked: <span className="text-foreground">{syncResult.total_checked}</span></span>
                      <span>Marked cancelling: <span className="text-destructive">{syncResult.marked_cancelling}</span></span>
                      <span>Cleared (reactivated): <span className="text-green-400">{syncResult.cleared}</span></span>
                      <span>Already ended: <span className="text-muted-foreground">{syncResult.already_deleted}</span></span>
                    </div>
                    {syncResult.details?.length > 0 && (
                      <div className="max-h-64 overflow-y-auto bg-input/30 rounded p-2 space-y-1.5">
                        {syncResult.details.map((d: any, i: number) => (
                          <div key={i} className={`font-mono-share text-[9px] border-b border-border/10 pb-1 ${
                            d.action?.includes("error") ? "text-destructive" :
                            d.action?.includes("cancelling") ? "text-destructive/80" :
                            d.action?.includes("cleared") ? "text-green-400/80" :
                            "text-muted-foreground/60"
                          }`}>
                            <p className="font-bold">{d.email}: {d.action}{d.cancel_at ? ` (${new Date(d.cancel_at).toLocaleDateString()})` : ""}</p>
                            {d.subs_found !== undefined && <p className="text-muted-foreground/40 ml-2">subs: {d.subs_found}</p>}
                            {d.statuses?.map((s: any, j: number) => (
                              <p key={j} className="text-muted-foreground/40 ml-2">
                                {s.id}: status={s.status}, cancel_at_end={String(s.cancel_at_period_end)}, cancel_at={s.cancel_at || "null"}, period_end={s.current_period_end}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
          </div>
        )}

        <footer className="text-center py-4">
          <p className="font-mono-share text-[10px] text-muted-foreground/30">
            ADMIN_CONSOLE // real-time data from Neon Postgres
          </p>
        </footer>
      </main>
    </div>
  );
}

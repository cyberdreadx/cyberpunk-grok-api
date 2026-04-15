import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
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

// ── Types ──

interface ModerationOffender {
  email: string; block_count: number; credits_burned: number; last_block: string;
}
interface ModerationStats {
  total_blocks: number; blocks_30d: number; blocks_today: number;
  total_credits_burned: number; credits_burned_30d: number;
  wasted_cost_total_cents: number; wasted_cost_30d_cents: number;
  offenders: ModerationOffender[];
}
interface Overview {
  users: { total_users: number; verified_users: number; active_subscribers: number; cancelling_subscribers: number; new_today: number; new_this_week: number };
  revenue: { total_revenue_cents: number; revenue_30d_cents: number; revenue_7d_cents: number; total_transactions: number; pack_purchases: number; sub_renewals: number };
  usage: { total_credits_used: number; credits_30d: number; credits_today: number; total_generations: number; generations_today: number };
  creditPool: { total_sub_credits_outstanding: number; total_pack_credits_outstanding: number };
  apiCost: { estimated30dCents: number; estimatedTotalCents: number };
  runpodCost?: { estimated30dCents: number };
  moderation: ModerationStats;
}

interface RevenueRow { day: string; revenue_cents: number; tx_count: number; packs: number; subs: number }
interface UserRow { day: string; new_users: number; cumulative: number }
interface UsageRow { day: string; mode: string; count: number; credits: number }
interface Transaction {
  created_at: string; email: string; type: string; package: string; credits: number; amount_cents: number; gateway: string;
}
interface TopUser {
  email: string; subscription_tier: string | null; subscription_cancel_at: string | null; sub_credits: number; pack_credits: number;
  created_at: string; total_spent_cents: number; total_generations: number; total_credits_used: number; last_generation: string | null;
}

// ── Shared Components ──

function KpiCard({ icon, label, value, sub, accent = "primary" }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; accent?: "primary" | "secondary" | "destructive";
}) {
  const borderMap = { primary: "border-primary/30", secondary: "border-secondary/30", destructive: "border-destructive/30" };
  const glowMap = { primary: "shadow-primary/5", secondary: "shadow-secondary/5", destructive: "shadow-destructive/5" };
  return (
    <div className={`border ${borderMap[accent]} rounded-lg bg-card/60 backdrop-blur-sm p-3 sm:p-4 shadow-lg ${glowMap[accent]} space-y-1 min-w-0 overflow-hidden`}>
      <div className="flex items-center gap-1.5 text-muted-foreground/60">
        {icon}
        <span className="font-mono-share text-[9px] sm:text-[10px] tracking-wider uppercase truncate">{label}</span>
      </div>
      <div className="font-orbitron text-lg sm:text-xl font-bold tracking-wide truncate">{value}</div>
      {sub && <div className="font-mono-share text-[9px] sm:text-[10px] text-muted-foreground/50 truncate">{sub}</div>}
    </div>
  );
}

function CyberTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card/95 border border-border/50 rounded px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="font-mono-share text-[10px] text-primary/70 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-mono-share text-xs" style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" && p.name?.toLowerCase().includes("revenue") ? fmt$(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ── Tab Definitions ──

type TabId = "overview" | "revenue" | "users" | "usage" | "moderation" | "referrals" | "payouts" | "emails" | "api" | "system" | "flash-sales";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "OVERVIEW", icon: <Eye className="w-3.5 h-3.5" /> },
  { id: "revenue", label: "REVENUE", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { id: "users", label: "USERS", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "usage", label: "USAGE", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "moderation", label: "DEFENSE", icon: <ShieldX className="w-3.5 h-3.5" /> },
  { id: "referrals", label: "REFERRALS", icon: <Share2 className="w-3.5 h-3.5" /> },
  { id: "payouts", label: "PAYOUTS", icon: <CreditCard className="w-3.5 h-3.5" /> },
  { id: "flash-sales", label: "FLASH SALES", icon: <Flame className="w-3.5 h-3.5" /> },
  { id: "emails", label: "EMAILS", icon: <Mail className="w-3.5 h-3.5" /> },
  { id: "api", label: "API", icon: <Key className="w-3.5 h-3.5" /> },
  { id: "system", label: "SYSTEM", icon: <Server className="w-3.5 h-3.5" /> },
];

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
  const [subject, setSubject] = useState("🚀 Grok Runner just got a massive upgrade");
  const [showEditor, setShowEditor] = useState(false);
  const [htmlContent, setHtmlContent] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await apiFetch("/admin", { method: "POST", body: { action: "announcement-stats" } });
      setStats(res);
    } catch { /* ignore */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleDryRun = async () => {
    setDryRunning(true);
    setResult(null);
    try {
      const res = await apiFetch("/admin", {
        method: "POST",
        body: { action: "send-announcement", dryRun: true, batchSize: 999999, offset: 0 },
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
          const body: any = { action: "send-announcement", batchSize, offset };
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
          {sending && (
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

      {/* Subject + Email Editor */}
      <div className="space-y-2">
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
                placeholder="Paste custom HTML here, or leave blank to use the default announcement template..."
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
                    apiFetch("/admin", { method: "POST", body: { action: "get-announcement-html" } })
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
    } catch { /* ignore */ }
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
    setEnding(saleId);
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "flash-sales-end", saleId } });
      fetchSales();
    } catch { /* ignore */ }
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
    } catch {
      // ignore
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
    } catch {
      // ignore
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

  if (loading) return <div className="py-8 text-center font-mono-share text-muted-foreground animate-pulse">Loading payouts...</div>;

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

  // User bans
  const [bans, setBans] = useState<any[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banEmail, setBanEmail] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banning, setBanning] = useState(false);

export default function Admin() {
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
  const [emailLogs, setEmailLogs] = useState<any[]>([]);
  const [emailStats, setEmailStats] = useState<any>(null);
  const [emailFilter, setEmailFilter] = useState<{ type?: string; status?: string }>({});
  const [emailLoading, setEmailLoading] = useState(false);
  const [apiAnalytics, setApiAnalytics] = useState<any>(null);
  const [apiAnalyticsLoading, setApiAnalyticsLoading] = useState(false);
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

  // Feed moderators
  const [modEmail, setModEmail] = useState("");
  const [mods, setMods] = useState<any[]>([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [modAction, setModAction] = useState(false);
  const [modResult, setModResult] = useState<{ ok: boolean; msg: string } | null>(null);

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

  const handleBan = async () => {
    if (!banEmail.trim()) return;
    setBanning(true);
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "ban-user", email: banEmail.trim(), reason: banReason.trim() || undefined } });
      setBanEmail(""); setBanReason("");
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

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    const errors: string[] = [];

    async function fetchAction(action: string) {
      try {
        return await apiFetch("/admin", { method: "POST", body: { action } });
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

      if (o) setOverview(o);
      if (r) setRevenue((r.revenue || []).map((row: RevenueRow) => ({ ...row, day: fmtDate(row.day) })));
      if (u) setUsers((u.users || []).map((row: UserRow) => ({ ...row, day: fmtDate(row.day) })));
      if (us) setUsage(us.usage || []);
      if (t) setTopUsers(t.topUsers || []);
      if (tx) setTransactions(tx.transactions || []);
      if (ref) setReferralStats(ref.referrals || null);
      if (rb) setRevenueBreakdown(rb);
      if (pb) setProfitBreakdown(pb.profitBreakdown || []);

      setAuthorized(true);
      setError(errors.length > 0 ? errors.join(" | ") : null);
    } catch {
      setAuthorized(false);
      setError(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
    try {
      const res = await apiFetch("/admin", { method: "POST", body: { action: "api-analytics" } });
      setApiAnalytics(res);
    } catch (err: any) {
      console.error("[admin] api-analytics failed:", err.message);
    } finally {
      setApiAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "api" && !apiAnalytics && !apiAnalyticsLoading && authorized) {
      fetchApiAnalytics();
    }
  }, [activeTab, apiAnalytics, apiAnalyticsLoading, authorized, fetchApiAnalytics]);

  const usagePivot = React.useMemo(() => {
    const map = new Map<string, { day: string } & Record<string, number>>();
    for (const row of usage) {
      const d = fmtDate(row.day);
      const entry = map.get(d) ?? ({ day: d } as { day: string } & Record<string, number>);
      (entry as Record<string, number>)[row.mode] = ((entry as Record<string, number>)[row.mode] || 0) + row.count;
      map.set(d, entry);
    }
    return Array.from(map.values());
  }, [usage]);

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

  if (error || !overview) {
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
  const xaiCost30d = o.apiCost.estimated30dCents;
  const runpodCost30d = o.runpodCost?.estimated30dCents || 0;
  const modCost30d = o.moderation.wasted_cost_30d_cents;
  const totalCost30d = xaiCost30d + runpodCost30d + modCost30d;
  const trueMargin30d = o.revenue.revenue_30d_cents - totalCost30d;

  return (
    <div className="min-h-screen bg-background w-full overflow-x-hidden">
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

      {/* Tab Bar */}
      <nav className="border-b border-border/20 bg-card/20 backdrop-blur-sm sticky top-[53px] z-10 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 flex gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 font-orbitron text-[9px] sm:text-[10px] tracking-wider border-b-2 transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-card/40"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* ═══ OVERVIEW TAB ═══ */}
        {activeTab === "overview" && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard icon={<Users className="w-4 h-4" />} label="TOTAL_USERS" value={o.users.total_users} sub={`${o.users.verified_users} verified // +${o.users.new_this_week} this week`} />
              <KpiCard icon={<DollarSign className="w-4 h-4" />} label="REVENUE_30D" value={fmt$(o.revenue.revenue_30d_cents)} sub={`${fmt$(o.revenue.total_revenue_cents)} lifetime`} accent="secondary" />
              <KpiCard icon={<Zap className="w-4 h-4" />} label="CREDITS_USED_30D" value={o.usage.credits_30d.toLocaleString()} sub={`${o.usage.generations_today} today // ${o.usage.total_generations} total`} />
              <KpiCard icon={<Crown className="w-4 h-4" />} label="SUBSCRIBERS" value={o.users.active_subscribers} sub={`${o.users.cancelling_subscribers} cancelling // ${o.revenue.pack_purchases} pack buys`} accent="secondary" />
            </section>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard icon={<CreditCard className="w-4 h-4" />} label="xAI_COST_30D" value={fmt$(xaiCost30d)} sub="estimated xAI API spend" accent="destructive" />
              <KpiCard icon={<Server className="w-4 h-4" />} label="RUNPOD_COST_30D" value={runpodCost30d ? fmt$(runpodCost30d) : "N/A"} sub={runpodCost30d ? "tracked from execution time" : "enable tracking to see"} accent="destructive" />
              <KpiCard icon={<Ban className="w-4 h-4" />} label="MOD_WASTE_30D" value={fmt$(modCost30d)} sub={`${o.moderation.blocks_30d} flagged requests`} accent="destructive" />
              <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="TRUE_MARGIN_30D" value={fmt$(trueMargin30d)} sub={`${Math.round((trueMargin30d / Math.max(1, o.revenue.revenue_30d_cents)) * 100)}% of revenue`} accent={trueMargin30d >= 0 ? "secondary" : "destructive"} />
            </section>

            <section className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
              <KpiCard icon={<Activity className="w-4 h-4" />} label="CREDITS_OUTSTANDING" value={(o.creditPool.total_sub_credits_outstanding + o.creditPool.total_pack_credits_outstanding).toLocaleString()} sub={`${o.creditPool.total_sub_credits_outstanding.toLocaleString()} sub + ${o.creditPool.total_pack_credits_outstanding.toLocaleString()} pack`} />
              <KpiCard icon={<DollarSign className="w-4 h-4" />} label="REVENUE_7D" value={fmt$(o.revenue.revenue_7d_cents)} sub={`${o.revenue.total_transactions} total txns`} accent="secondary" />
              <KpiCard icon={<Crown className="w-4 h-4" />} label="SUB_RENEWALS" value={o.revenue.sub_renewals} sub={`${o.revenue.pack_purchases} pack purchases`} accent="secondary" />
            </section>
          </>
        )}

        {/* ═══ REVENUE TAB ═══ */}
        {activeTab === "revenue" && (
          <>
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
              <h2 className="font-orbitron text-xs tracking-wider text-primary/80 mb-4 flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5" />
                REVENUE_STREAM (30d)
              </h2>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={revenue}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--secondary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--secondary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmt$(v)} width={48} />
                  <Tooltip content={<CyberTooltip />} />
                  <Area type="monotone" dataKey="revenue_cents" name="Revenue" stroke="hsl(var(--secondary))" fill="url(#revGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {revenueBreakdown && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
                  <div className="px-3 sm:px-4 py-3 border-b border-border/30">
                    <h2 className="font-orbitron text-xs tracking-wider text-secondary/80 flex items-center gap-2">
                      <CreditCard className="w-3.5 h-3.5" />
                      REVENUE_BY_PACK (30d)
                    </h2>
                  </div>
                  <div className="overflow-x-auto overscroll-x-contain">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border/20">
                          {["PACK", "TYPE", "COUNT", "REVENUE", "CREDITS"].map((h) => (
                            <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(revenueBreakdown.byPack30d || []).map((row: any, i: number) => (
                          <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                            <td className="px-2.5 py-2 font-orbitron text-[10px] tracking-wider text-foreground/80">{row.package?.toUpperCase() || "--"}</td>
                            <td className="px-2.5 py-2">
                              <span className={`font-orbitron text-[9px] tracking-wider px-2 py-0.5 rounded border ${
                                row.type === "subscription" ? "bg-secondary/20 text-secondary border-secondary/30" : "bg-primary/20 text-primary border-primary/30"
                              }`}>{row.type?.toUpperCase()}</span>
                            </td>
                            <td className="px-2.5 py-2 font-mono-share text-xs font-bold">{row.count}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-secondary font-bold">{fmt$(row.total_cents)}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-primary">{row.total_credits?.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                            }`}>{row.gateway === "xrge" ? "$XRGE" : row.gateway?.toUpperCase()}</span>
                            <div className="flex items-center gap-3">
                              <span className="font-mono-share text-[10px] text-muted-foreground/60">{row.count} txns</span>
                              <span className="font-mono-share text-sm text-secondary font-bold">{fmt$(row.total_cents)}</span>
                              <span className="font-mono-share text-[10px] text-muted-foreground/40">{pct}%</span>
                            </div>
                          </div>
                          <div className="w-full bg-border/20 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              row.gateway === "stripe" ? "bg-indigo-500" : row.gateway === "paypal" ? "bg-blue-500" : row.gateway === "xrge" ? "bg-pink-500" : "bg-muted-foreground"
                            }`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
              <h2 className="font-orbitron text-xs tracking-wider text-primary/80 mb-4 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" />
                USER_GROWTH (30d)
              </h2>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={users}>
                  <defs>
                    <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} />
                  <Tooltip content={<CyberTooltip />} />
                  <Area type="monotone" dataKey="cumulative" name="Total Users" stroke="hsl(var(--primary))" fill="url(#userGrad)" strokeWidth={2} />
                  <Bar dataKey="new_users" name="New Users" fill="hsl(var(--primary))" fillOpacity={0.5} />
                </AreaChart>
              </ResponsiveContainer>
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
              </div>
              {grantResult && (
                <div className={`font-mono-share text-[10px] px-2 py-1.5 rounded ${grantResult.ok ? "bg-green-500/10 text-green-400" : "bg-destructive/10 text-destructive"}`}>
                  {grantResult.msg}
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
                <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" />
                  TOP_OPERATORS (by usage)
                </h2>
              </div>
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[560px]">
                  <thead><tr className="border-b border-border/20">
                    {["OPERATOR", "TIER", "SPENT", "GENS", "USED", "BAL", "LAST"].map((h) => (
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
                        <td className="px-2.5 py-2 font-mono-share text-xs text-secondary">{fmt$(u.total_spent_cents)}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs">{u.total_generations}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs">{u.total_credits_used}</td>
                        <td className="px-2.5 py-2 font-mono-share text-xs text-primary">{u.sub_credits + u.pack_credits}</td>
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/50">
                          {u.last_generation ? new Date(u.last_generation).toLocaleDateString() : "never"}
                        </td>
                      </tr>
                    ))}
                    {topUsers.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center font-mono-share text-xs text-muted-foreground/40">No operator data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ═══ USAGE TAB ═══ */}
        {activeTab === "usage" && (
          <>
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
              <h2 className="font-orbitron text-xs tracking-wider text-primary/80 mb-4 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" />
                GENERATION_VOLUME (30d)
              </h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={usagePivot}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} />
                  <Tooltip content={<CyberTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 9, fontFamily: "var(--font-mono-share)" }} />
                  <Bar dataKey="generate-image" name="Images" stackId="a" fill="hsl(var(--primary))" fillOpacity={0.8} />
                  <Bar dataKey="edit-image" name="Edits" stackId="a" fill="hsl(var(--secondary))" fillOpacity={0.8} />
                  <Bar dataKey="generate-video" name="Videos" stackId="a" fill="#ff6b6b" fillOpacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard icon={<Activity className="w-4 h-4" />} label="CREDITS_OUTSTANDING" value={(o.creditPool.total_sub_credits_outstanding + o.creditPool.total_pack_credits_outstanding).toLocaleString()} sub={`${o.creditPool.total_sub_credits_outstanding.toLocaleString()} sub + ${o.creditPool.total_pack_credits_outstanding.toLocaleString()} pack`} />
              <KpiCard icon={<Zap className="w-4 h-4" />} label="CREDITS_TODAY" value={o.usage.credits_today.toLocaleString()} sub={`${o.usage.generations_today} generations`} />
              <KpiCard icon={<Zap className="w-4 h-4" />} label="TOTAL_GENERATIONS" value={o.usage.total_generations.toLocaleString()} sub={`${o.usage.total_credits_used.toLocaleString()} credits all-time`} />
              <KpiCard icon={<Server className="w-4 h-4" />} label="RUNPOD_COST_30D" value={runpodCost30d ? fmt$(runpodCost30d) : "N/A"} sub="from execution time tracking" accent="destructive" />
            </section>

            {profitBreakdown.length > 0 && (
              <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
                <div className="px-3 sm:px-4 py-3 border-b border-border/30">
                  <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
                    <BarChart3 className="w-3.5 h-3.5" />
                    PROFIT_PER_ACTION (30d)
                  </h2>
                </div>
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[500px]">
                    <thead><tr className="border-b border-border/20">
                      {["MODE", "GENS", "CREDITS", "AVG CR/GEN", "TRACKED", "AVG TIME", "EST. RUNPOD"].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {profitBreakdown.map((row: any, i: number) => {
                        const avgCr = row.generations > 0 ? (row.credits_used / row.generations).toFixed(1) : "—";
                        const totalMs = Number(row.total_exec_ms);
                        const avgTimeS = row.tracked_count > 0 ? (totalMs / row.tracked_count / 1000).toFixed(1) + "s" : "—";
                        const estRunpodCents = Math.round((totalMs / 1000) * 0.155);
                        return (
                          <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                            <td className="px-2.5 py-2 font-orbitron text-[10px] tracking-wider text-foreground/80">{row.mode?.toUpperCase()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs">{row.generations}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-primary font-bold">{row.credits_used.toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs">{avgCr}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-muted-foreground/50">{row.tracked_count}/{row.generations}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs">{avgTimeS}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-destructive">{estRunpodCents > 0 ? fmt$(estRunpodCents) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
                <KpiCard icon={<Ban className="w-4 h-4" />} label="FLAGGED_30D" value={o.moderation.blocks_30d} sub={`${o.moderation.blocks_today} today // ${o.moderation.total_blocks} total`} accent="destructive" />
                <KpiCard icon={<Flame className="w-4 h-4" />} label="CREDITS_BURNED_30D" value={o.moderation.credits_burned_30d} sub={`${o.moderation.total_credits_burned} lifetime (not refunded)`} accent="destructive" />
                <KpiCard icon={<CreditCard className="w-4 h-4" />} label="xAI_WASTE_30D" value={fmt$(o.moderation.wasted_cost_30d_cents)} sub={`${fmt$(o.moderation.wasted_cost_total_cents)} lifetime (xAI still charges you)`} accent="destructive" />
              </div>
              {o.moderation.offenders && o.moderation.offenders.length > 0 && (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[400px]">
                    <thead><tr className="border-b border-red-500/20">
                      {["USER", "FLAGS", "CREDITS", "LAST"].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-red-400/50 tracking-wider">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {o.moderation.offenders.map((off, i) => (
                        <tr key={i} className="border-b border-red-500/10 hover:bg-red-500/5 transition-colors">
                          <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{off.email}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-red-400 font-bold">{off.block_count}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-red-400">{off.credits_burned}</td>
                          <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/50">
                            {off.last_block ? new Date(off.last_block).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                <KpiCard icon={<Share2 className="w-4 h-4" />} label="TOTAL_REFERRALS" value={referralStats.total_referrals} sub={`${referralStats.verified} verified`} accent="secondary" />
                <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="CONVERTED" value={referralStats.converted} sub={`${referralStats.conversionRate}% of referrals purchased`} accent="secondary" />
                <KpiCard icon={<Gift className="w-4 h-4" />} label="CREDITS_GRANTED" value={referralStats.creditsGranted} sub="total referral credits given" accent="secondary" />
                <KpiCard icon={<Crown className="w-4 h-4" />} label="REWARDS_PAID" value={referralStats.rewarded} sub="referrers who earned 10 cr" accent="secondary" />
              </div>
              {referralStats.topReferrers && referralStats.topReferrers.length > 0 && (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[400px]">
                    <thead><tr className="border-b border-green-500/20">
                      {["REFERRER", "REFERRED", "CONVERTED", "REWARDS"].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-green-400/50 tracking-wider">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {referralStats.topReferrers.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-green-500/10 hover:bg-green-500/5 transition-colors">
                          <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{r.email}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-green-400 font-bold">{r.referral_count}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-green-400">{r.conversions}</td>
                          <td className="px-2.5 py-2 font-mono-share text-xs text-secondary">{r.rewards}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
            </div>

            {/* Log table */}
            <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border/20">
                      {["TIME", "RECIPIENT", "TYPE", "STATUS", "RESEND_ID", "ERROR"].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {emailLogs.length === 0 && !emailLoading && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center font-mono-share text-xs text-muted-foreground/50">No email logs found</td></tr>
                    )}
                    {emailLoading && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" /></td></tr>
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

            {apiAnalytics && (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
                  <KpiCard icon={<Users className="w-3.5 h-3.5" />} label="API USERS" value={apiAnalytics.kpis?.total_api_users || 0} sub={`${apiAnalytics.kpis?.active_keys || 0} active keys`} />
                  <KpiCard icon={<Zap className="w-3.5 h-3.5" />} label="TOTAL REQUESTS" value={(apiAnalytics.kpis?.total_requests || 0).toLocaleString()} />
                  <KpiCard icon={<CreditCard className="w-3.5 h-3.5" />} label="CREDITS VIA API" value={(apiAnalytics.kpis?.total_credits_used || 0).toLocaleString()} />
                  <KpiCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="30D CREDITS" value={(apiAnalytics.apiRevenue?.credits_30d || 0).toLocaleString()} sub={`7d: ${apiAnalytics.apiRevenue?.credits_7d || 0}`} />
                  <KpiCard icon={<DollarSign className="w-3.5 h-3.5" />} label="EST. API REV (30D)" value={fmt$(Math.round((apiAnalytics.apiRevenue?.credits_30d || 0) * 7.5))} sub="@ ~$0.075/credit" accent="secondary" />
                </div>

                {/* Daily Volume Chart */}
                {apiAnalytics.dailyVolume?.length > 0 && (
                  <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="w-3.5 h-3.5 text-primary" />
                      <span className="font-orbitron text-[10px] tracking-wider text-muted-foreground">DAILY_API_VOLUME (30D)</span>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={apiAnalytics.dailyVolume.map((r: any) => ({ ...r, day: fmtDate(r.day) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.2} />
                        <XAxis dataKey="day" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip content={<CyberTooltip />} />
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
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">REQUESTS</th>
                          <th className="px-2.5 py-1.5 font-orbitron text-[9px] tracking-wider text-muted-foreground/50 text-right">CREDITS</th>
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
                            <td className="px-2.5 py-2 font-mono-share text-xs text-right">{(c.total_requests || 0).toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-xs text-right text-secondary">{(c.total_credits || 0).toLocaleString()}</td>
                            <td className="px-2.5 py-2 font-mono-share text-[9px] text-muted-foreground/40 text-right">
                              {c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : "never"}
                            </td>
                          </tr>
                        ))}
                        {(!apiAnalytics.topConsumers || apiAnalytics.topConsumers.length === 0) && (
                          <tr>
                            <td colSpan={5} className="px-2.5 py-4 text-center font-mono-share text-xs text-muted-foreground/40">
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

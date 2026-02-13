import React, { useEffect, useState, useCallback } from "react";
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

const ADMIN_EMAIL = "cyberdreadx@proton.me";

// â”€â”€ Helpers â”€â”€

function fmt$(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// â”€â”€ Types â”€â”€

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

// â”€â”€ KPI Card â”€â”€

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

// â”€â”€ Cyber Tooltip â”€â”€

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

// â”€â”€ Main Admin Page â”€â”€

export default function Admin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [referralStats, setReferralStats] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    const errors: string[] = [];

    // Helper: fetch one action, return null on failure
    async function fetchAction(action: string) {
      try {
        return await apiFetch("/admin", { method: "POST", body: { action } });
      } catch (err: any) {
        const msg = err.message || String(err);
        // Auth errors should stop everything
        if (msg.includes("Access denied") || msg.includes("403") || msg.includes("Unauthorized")) {
          throw err;
        }
        console.error(`[admin] ${action} failed:`, msg);
        errors.push(`${action}: ${msg}`);
        return null;
      }
    }

    try {
      const [o, r, u, us, t, tx, ref] = await Promise.all([
        fetchAction("overview"),
        fetchAction("revenue"),
        fetchAction("users"),
        fetchAction("usage"),
        fetchAction("top-users"),
        fetchAction("transactions"),
        fetchAction("referrals"),
      ]);

      if (o) setOverview(o);
      if (r) setRevenue((r.revenue || []).map((row: RevenueRow) => ({ ...row, day: fmtDate(row.day) })));
      if (u) setUsers((u.users || []).map((row: UserRow) => ({ ...row, day: fmtDate(row.day) })));
      if (us) setUsage(us.usage || []);
      if (t) setTopUsers(t.topUsers || []);
      if (tx) setTransactions(tx.transactions || []);
      if (ref) setReferralStats(ref.referrals || null);

      setAuthorized(true);
      setError(errors.length > 0 ? errors.join(" | ") : null);
    } catch (err: any) {
      // Auth error thrown from fetchAction
      setAuthorized(false);
      setError(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAuthToken()) {
      setLoading(false);
      setAuthorized(false);
      return;
    }
    fetchAll();
  }, [fetchAll]);

  // Pivot usage data into { day, generate-image, edit-image, generate-video }
  const usagePivot = React.useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const row of usage) {
      const d = fmtDate(row.day);
      const entry = map.get(d) || { day: d };
      entry[row.mode] = (entry[row.mode] || 0) + row.count;
      map.set(d, entry);
    }
    return Array.from(map.values());
  }, [usage]);

  // â”€â”€ Access denied / loading â”€â”€
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
  const profitMargin30d = o.revenue.revenue_30d_cents - o.apiCost.estimated30dCents;

  return (
    <div className="min-h-screen bg-background w-full overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-border/30 bg-card/40 backdrop-blur-sm sticky top-0 z-10">
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
            <span className="font-mono-share text-[9px] text-muted-foreground/40 hidden md:inline">{ADMIN_EMAIL}</span>
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

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* KPI Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <KpiCard icon={<Users className="w-4 h-4" />} label="TOTAL_USERS" value={o.users.total_users} sub={`${o.users.verified_users} verified // +${o.users.new_this_week} this week`} />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="REVENUE_30D" value={fmt$(o.revenue.revenue_30d_cents)} sub={`${fmt$(o.revenue.total_revenue_cents)} lifetime`} accent="secondary" />
          <KpiCard icon={<Zap className="w-4 h-4" />} label="GENERATIONS_30D" value={o.usage.credits_30d} sub={`${o.usage.generations_today} today // ${o.usage.total_generations} total`} />
          <KpiCard icon={<Crown className="w-4 h-4" />} label="SUBSCRIBERS" value={o.users.active_subscribers} sub={`${o.users.cancelling_subscribers} cancelling // ${o.revenue.pack_purchases} pack buys // ${o.revenue.sub_renewals} renewals`} accent="secondary" />
        </section>

        {/* Financial overview */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <KpiCard icon={<CreditCard className="w-4 h-4" />} label="API_COST_30D" value={fmt$(o.apiCost.estimated30dCents)} sub="estimated xAI spend" accent="destructive" />
          <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="MARGIN_30D" value={fmt$(profitMargin30d)} sub={profitMargin30d >= 0 ? "revenue - api cost" : "WARNING: negative margin"} accent={profitMargin30d >= 0 ? "secondary" : "destructive"} />
          <KpiCard icon={<Activity className="w-4 h-4" />} label="CREDITS_OUTSTANDING" value={(o.creditPool.total_sub_credits_outstanding + o.creditPool.total_pack_credits_outstanding).toLocaleString()} sub={`${o.creditPool.total_sub_credits_outstanding} sub + ${o.creditPool.total_pack_credits_outstanding} pack`} />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="REVENUE_7D" value={fmt$(o.revenue.revenue_7d_cents)} sub={`${o.revenue.total_transactions} total txns`} accent="secondary" />
        </section>

        {/* Moderation Defense */}
        {o.moderation && (
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
              {/* Moderation KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                <KpiCard icon={<Ban className="w-4 h-4" />} label="FLAGGED_30D" value={o.moderation.blocks_30d} sub={`${o.moderation.blocks_today} today // ${o.moderation.total_blocks} total`} accent="destructive" />
                <KpiCard icon={<Flame className="w-4 h-4" />} label="CREDITS_USED_30D" value={o.moderation.credits_burned_30d} sub={`${o.moderation.total_credits_burned} lifetime (not refunded)`} accent="destructive" />
                <KpiCard icon={<CreditCard className="w-4 h-4" />} label="xAI_COST_30D" value={fmt$(o.moderation.wasted_cost_30d_cents)} sub={`${fmt$(o.moderation.wasted_cost_total_cents)} lifetime (xAI still charges you)`} accent="destructive" />
              </div>
              {/* Flagged Users */}
              {o.moderation.offenders && o.moderation.offenders.length > 0 && (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[400px]">
                    <thead>
                      <tr className="border-b border-red-500/20">
                        {["USER", "FLAGS", "CREDITS", "LAST"].map((h) => (
                          <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-red-400/50 tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
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

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          {/* Revenue Chart */}
          <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
            <h2 className="font-orbitron text-xs tracking-wider text-primary/80 mb-4 flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5" />
              REVENUE_STREAM (30d)
            </h2>
            <ResponsiveContainer width="100%" height={200}>
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

          {/* User Growth Chart */}
          <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 min-w-0 overflow-hidden">
            <h2 className="font-orbitron text-xs tracking-wider text-primary/80 mb-4 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              USER_GROWTH
            </h2>
            <ResponsiveContainer width="100%" height={200}>
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

          {/* Generation Volume */}
          <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm p-3 sm:p-4 lg:col-span-2 min-w-0 overflow-hidden">
            <h2 className="font-orbitron text-xs tracking-wider text-primary/80 mb-4 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" />
              GENERATION_VOLUME (30d)
            </h2>
            <ResponsiveContainer width="100%" height={200}>
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
        </div>

        {/* Top Users Table */}
        <section className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm overflow-hidden">
          <div className="px-3 sm:px-4 py-3 border-b border-border/30">
            <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              TOP_OPERATORS (by usage)
            </h2>
          </div>
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-border/20">
                  {["OPERATOR", "TIER", "SPENT", "GENS", "USED", "BAL", "LAST"].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topUsers.map((u, i) => (
                  <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                    <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{u.email}</td>
                    <td className="px-2.5 py-2">
                      {u.subscription_tier ? (
                        <span className={`font-orbitron text-[9px] tracking-wider px-2 py-0.5 rounded border ${
                          u.subscription_cancel_at
                            ? "bg-destructive/20 text-destructive border-destructive/30"
                            : "bg-secondary/20 text-secondary border-secondary/30"
                        }`}>
                          {u.subscription_tier.toUpperCase()}
                          {u.subscription_cancel_at && " (ending)"}
                        </span>
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

        {/* Transaction Log */}
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
              <thead>
                <tr className="border-b border-border/20">
                  {["DATE", "USER", "TYPE", "PKG", "CR", "AMT", "VIA"].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <tr key={i} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                    <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/60 whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/80">{tx.email || "unknown"}</td>
                    <td className="px-2.5 py-2">
                      <span className={`font-orbitron text-[9px] tracking-wider px-2 py-0.5 rounded border ${
                        tx.type === "subscription"
                          ? "bg-secondary/20 text-secondary border-secondary/30"
                          : "bg-primary/20 text-primary border-primary/30"
                      }`}>
                        {tx.type?.toUpperCase() || "â€”"}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 font-mono-share text-xs text-foreground/70">{tx.package?.toUpperCase() || "â€”"}</td>
                    <td className="px-2.5 py-2 font-mono-share text-xs text-primary font-bold">{tx.credits}</td>
                    <td className="px-2.5 py-2 font-mono-share text-xs text-secondary">{fmt$(tx.amount_cents)}</td>
                    <td className="px-2.5 py-2">
                      <span className={`font-mono-share text-[9px] px-2 py-0.5 rounded ${
                        tx.gateway === "stripe"
                          ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                          : tx.gateway === "paypal"
                          ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                          : "bg-muted/20 text-muted-foreground"
                      }`}>
                        {tx.gateway?.toUpperCase() || "â€”"}
                      </span>
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

        {/* Referral Program */}
        {referralStats && (
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
                    <thead>
                      <tr className="border-b border-green-500/20">
                        {["REFERRER", "REFERRED", "CONVERTED", "REWARDS"].map((h) => (
                          <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-green-400/50 tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
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

        {/* Footer */}
        <footer className="text-center py-4">
          <p className="font-mono-share text-[10px] text-muted-foreground/30">
            ADMIN_CONSOLE // real-time data from Neon Postgres
          </p>
        </footer>
      </main>
    </div>
  );
}
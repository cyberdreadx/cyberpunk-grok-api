/**
 * FINANCE tab — Stripe ground truth, reconciled against our own ledger.
 *
 * The rest of the admin panel reports what the `transactions` table recorded.
 * That table only learns about money when a webhook lands, and it never hears
 * about fees, refunds or chargebacks — so it answers "what did we book", not
 * "what did we make". This panel reads Stripe's balance-transaction ledger,
 * the same source its own dashboard reports from, and puts the two side by
 * side so any gap is visible instead of silently absorbed.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  DollarSign, Loader2, RefreshCw, TrendingUp, TrendingDown, AlertTriangle,
  Crown, Server, Percent, Landmark, Cpu,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import RangeControl, { type ChartRange } from "@/components/admin/RangeControl";

function fmt$(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "--";
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  return `${neg ? "-" : ""}$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "--";
  return `${(v * 100).toFixed(digits)}%`;
}
function shortDate(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Stat({ icon, label, value, sub, tone = "neutral" }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const toneMap = {
    neutral: "bg-primary/10 text-primary",
    good: "bg-secondary/10 text-secondary",
    bad: "bg-destructive/10 text-destructive",
    warn: "bg-amber-500/10 text-amber-400",
  };
  return (
    <div className="holo-card p-3 sm:p-4 space-y-1.5 min-w-0 overflow-hidden" data-numeric>
      <div className="flex items-center gap-2 text-muted-foreground/70">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${toneMap[tone]}`}>{icon}</span>
        <span className="font-mono-share text-[10px] tracking-wider uppercase truncate">{label}</span>
      </div>
      <div className="font-orbitron text-xl sm:text-2xl font-bold tracking-wide truncate">{value}</div>
      {sub && <div className="font-mono-share text-[10px] text-muted-foreground/60 truncate">{sub}</div>}
    </div>
  );
}

function Panel({ title, icon, right, children }: {
  title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="border border-border/30 rounded-lg bg-card/40 backdrop-blur-sm min-w-0 overflow-hidden">
      <div className="px-3 sm:px-4 py-3 border-b border-border/30 flex items-center gap-2 flex-wrap">
        <h2 className="font-orbitron text-xs tracking-wider text-primary/80 flex items-center gap-2">
          {icon}{title}
        </h2>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </div>
  );
}

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card/95 border border-border/50 rounded px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="font-mono-share text-[10px] text-primary/70 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-mono-share text-xs" style={{ color: p.color }}>
          {p.name}: {fmt$(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function AdminFinancePanel({ range, onRangeChange }: {
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [runpod, setRunpod] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    const body = { days: range.days, ...(range.bucket ? { bucket: range.bucket } : {}) };
    try {
      const [fin, rp] = await Promise.all([
        apiFetch("/admin", { method: "POST", body: { action: "finance", ...body, refresh: forceRefresh } }),
        apiFetch("/admin", { method: "POST", body: { action: "runpod-truth", ...body } }).catch(() => null),
      ]);
      setData(fin);
      setRunpod(rp);
    } catch (err: any) {
      setError(err?.message || "Failed to load finance data");
    } finally {
      setLoading(false);
    }
  }, [range.days, range.bucket]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="border border-destructive/40 rounded-lg bg-destructive/5 p-4 space-y-3">
        <p className="font-mono-share text-xs text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => load()} className="font-mono-share text-xs">RETRY</Button>
      </div>
    );
  }

  const s = data?.stripe;
  const mrr = data?.mrr;
  const recon = data?.reconciliation;
  const margin = data?.margin;
  const stripeMissing = !s;

  const comparison = (recon?.comparison ?? []).map((r: any) => ({
    ...r, label: shortDate(r.day),
  }));

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <RangeControl value={range} onChange={onRangeChange} />
        <Button
          variant="outline" size="sm" onClick={() => load(true)} disabled={loading}
          className="font-mono-share text-[10px] gap-1.5 ml-auto"
          title="Bypass the 10-minute Stripe cache"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          RESYNC_STRIPE
        </Button>
      </div>

      {stripeMissing && (
        <div className="border border-amber-500/40 bg-amber-500/10 rounded-lg px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="font-mono-share text-[11px] text-amber-300">
            Stripe unavailable — showing ledger figures only. Check STRIPE_SECRET_KEY.
          </span>
        </div>
      )}

      {s && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <Stat icon={<DollarSign className="w-4 h-4" />} label="STRIPE_GROSS"
              value={fmt$(s.grossCents)} sub={`${s.chargeCount} charges`} />
            <Stat icon={<Percent className="w-4 h-4" />} label="STRIPE_FEES"
              value={fmt$(s.feeCents + s.otherFeeCents)}
              sub={`${pct(s.effectiveFeeRate, 2)} effective rate`} tone="bad" />
            <Stat icon={<Landmark className="w-4 h-4" />} label="NET_RECEIVED"
              value={fmt$(s.netCents)}
              sub={s.refundCents > 0 ? `after ${fmt$(s.refundCents)} refunds` : "after fees + refunds"} tone="good" />
            <Stat icon={margin && margin.profitCents >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              label="TRUE_PROFIT" value={fmt$(margin?.profitCents)}
              sub={`${pct(margin?.marginPct)} of net // ${fmt$(data.cost?.cents)} cost`}
              tone={margin && margin.profitCents >= 0 ? "good" : "bad"} />
          </section>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <Stat icon={<Crown className="w-4 h-4" />} label="MRR"
              value={fmt$(mrr?.mrrCents)} sub={`${mrr?.activeCount ?? 0} active subs`} tone="good" />
            <Stat icon={<Crown className="w-4 h-4" />} label="ARR"
              value={fmt$(mrr?.arrCents)} sub="MRR × 12" tone="good" />
            <Stat icon={<AlertTriangle className="w-4 h-4" />} label="MRR_AT_RISK"
              value={fmt$(mrr?.atRiskCents)}
              sub={`${mrr?.cancellingCount ?? 0} cancelling at period end`}
              tone={mrr?.atRiskCents ? "warn" : "neutral"} />
            <Stat icon={<Landmark className="w-4 h-4" />} label="STRIPE_BALANCE"
              value={fmt$(data.balance?.availableCents)}
              sub={`${fmt$(data.balance?.pendingCents)} pending`} />
          </section>

          {/* ── Reconciliation ── */}
          {recon && (
            <Panel
              title="LEDGER_RECONCILIATION"
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              right={
                <span className={`font-mono-share text-[10px] px-2 py-0.5 rounded border ${
                  Math.abs(recon.driftPct) > 0.02
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-secondary/40 bg-secondary/10 text-secondary"
                }`}>
                  DRIFT {fmt$(recon.driftCents)} ({pct(recon.driftPct)})
                </span>
              }
            >
              <p className="font-mono-share text-[10px] text-muted-foreground/60 mb-3 leading-relaxed">
                Stripe charged <strong className="text-foreground/80">{fmt$(recon.stripeGrossCents)}</strong> across{" "}
                {recon.stripeCount} charges; our transactions table booked{" "}
                <strong className="text-foreground/80">{fmt$(recon.ledgerCents)}</strong> across {recon.ledgerCount}.
                A positive drift is money Stripe collected that never reached the ledger — creator-verification
                checkouts never write a row at all, and subscription renewals went unrecorded for April–May 2026.
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={comparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmt$(v)} width={58} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="stripeGross" name="Stripe" fill="hsl(var(--secondary))" fillOpacity={0.75} />
                  <Bar dataKey="ledgerBooked" name="Ledger" fill="hsl(var(--primary))" fillOpacity={0.75} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}

          {/* ── Net revenue over time ── */}
          <Panel title="NET_REVENUE" icon={<DollarSign className="w-3.5 h-3.5" />}>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={(s.series || []).map((r: any) => ({ ...r, label: shortDate(r.day) }))}>
                <defs>
                  <linearGradient id="finNetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--secondary))" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="hsl(var(--secondary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmt$(v)} width={58} />
                <Tooltip content={<MoneyTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Area type="monotone" dataKey="gross" name="Gross" stroke="hsl(var(--primary))" fill="none" strokeWidth={1.5} strokeDasharray="4 3" />
                <Area type="monotone" dataKey="net" name="Net" stroke="hsl(var(--secondary))" fill="url(#finNetGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* ── MRR by price ── */}
          {mrr?.byPrice?.length > 0 && (
            <Panel title="MRR_BY_PLAN" icon={<Crown className="w-3.5 h-3.5" />}>
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/20">
                      {["PLAN", "LIST_PRICE", "SUBS", "MRR", "SHARE"].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mrr.byPrice.map((p: any) => (
                      <tr key={p.priceId} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-foreground/80">{p.nickname}</td>
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/70" data-numeric>{fmt$(p.unitAmount)}</td>
                        <td className="px-2.5 py-2 font-mono-share text-[10px]" data-numeric>{p.count}</td>
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-secondary" data-numeric>{fmt$(p.mrrCents)}</td>
                        <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/70" data-numeric>
                          {mrr.mrrCents > 0 ? pct(p.mrrCents / mrr.mrrCents, 0) : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="font-mono-share text-[10px] text-muted-foreground/50 mt-3">
                Read live off Stripe subscription items, so yearly plans are normalized to monthly and
                per-customer coupons are applied — neither of which the local subscription_tier string can express.
              </p>
            </Panel>
          )}
        </>
      )}

      {/* ── RunPod estimate vs reality ── */}
      {runpod && (
        <Panel
          title="RUNPOD_COST_TRUTH"
          icon={<Server className="w-3.5 h-3.5" />}
          right={
            runpod.live ? (
              <span className="font-mono-share text-[10px] text-muted-foreground/70">
                balance ${runpod.live.balanceUsd?.toFixed(2)} // ${runpod.live.spendPerHr?.toFixed(3)}/hr
              </span>
            ) : null
          }
        >
          <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4">
            <Stat icon={<Cpu className="w-4 h-4" />} label="EST_GPU_COST"
              value={fmt$(runpod.estimate?.blendedCents)}
              sub={`${runpod.estimate?.jobs?.toLocaleString?.() ?? 0} jobs // ${pct(runpod.estimate?.coverage, 0)} measured`} tone="bad" />
            <Stat icon={<Cpu className="w-4 h-4" />} label="GPU_SECONDS"
              value={Math.round((runpod.estimate?.execMs ?? 0) / 1000).toLocaleString()}
              sub={`@ ${runpod.estimate?.centsPerSec}¢/s assumed`} />
            <Stat icon={<Landmark className="w-4 h-4" />} label="ACTUAL_DRAWDOWN"
              value={runpod.actual ? fmt$(runpod.actual.spendCents) : "--"}
              sub={runpod.actual ? `${runpod.actual.samples} snapshots` : "awaiting snapshots"} tone="warn" />
            <Stat icon={<Percent className="w-4 h-4" />} label="ESTIMATE_ERROR"
              value={runpod.actual?.ratio ? `${runpod.actual.ratio.toFixed(2)}×` : "--"}
              sub={runpod.actual ? `${fmt$(runpod.actual.unexplainedCents)} unexplained` : "needs 2+ snapshots"}
              tone={runpod.actual?.ratio && runpod.actual.ratio > 1.25 ? "bad" : "neutral"} />
          </section>

          <p className="font-mono-share text-[10px] text-muted-foreground/60 mb-3 leading-relaxed">
            The estimate is execution time × one flat rate, which is the H200 price applied to every endpoint —
            several of which also schedule onto cheaper ADA workers. It also cannot see idle time, cold starts, or
            the GPU seconds erased when a job is refunded. Account-balance snapshots are the correction; a ratio
            above 1 means real spend exceeds what per-job time explains.
          </p>

          {runpod.perMode?.length > 0 && (
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/20">
                    {["MODE", "JOBS", "AVG_SEC", "COST", "COST/JOB"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left font-mono-share text-[9px] text-muted-foreground/50 tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runpod.perMode.map((m: any) => (
                    <tr key={m.mode} className="border-b border-border/10 hover:bg-primary/5 transition-colors">
                      <td className="px-2.5 py-2 font-mono-share text-[10px] text-foreground/80">{m.mode}</td>
                      <td className="px-2.5 py-2 font-mono-share text-[10px]" data-numeric>{m.jobs.toLocaleString()}</td>
                      <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/70" data-numeric>{m.avgSec.toFixed(1)}s</td>
                      <td className="px-2.5 py-2 font-mono-share text-[10px] text-destructive" data-numeric>{fmt$(m.cents)}</td>
                      <td className="px-2.5 py-2 font-mono-share text-[10px] text-muted-foreground/70" data-numeric>
                        {m.jobs > 0 ? `${(m.cents / m.jobs).toFixed(2)}¢` : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

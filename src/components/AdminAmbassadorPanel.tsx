/**
 * AMBASSADORS tab — approve promoters, watch the commission liability.
 *
 * Two things this panel exists to make hard to get wrong:
 *
 * 1. Approval is the fraud control. The open referral system already has
 *    accounts with 300–700 signups and zero sales, so every application is
 *    shown next to whether that person has ever paid, what their existing
 *    referrals converted at, and how many accounts share their device
 *    fingerprint. A farmer and a real creator look identical without that.
 *
 * 2. Pending commission is a liability, not revenue. It's money already owed
 *    on payments that have settled, sitting inside the hold window. It leads
 *    the summary for that reason.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Award, Loader2, RefreshCw, Check, X, Users, DollarSign, Clock, ShieldAlert,
  MousePointerClick, CalendarPlus, Ban, Play, Pause, AlertTriangle, ExternalLink,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

function fmt$(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "--";
  const neg = cents < 0;
  return `${neg ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

interface Roster {
  id: string; code: string; status: string; commission_pct: string; commission_months: number;
  hold_days: number; tier: string; display_name: string | null; email: string | null;
  username: string; cash_balance_cents: number; signups: number; converted: number;
  disqualified: number; clicks: number; pending_cents: number;
  lifetime_gross_cents: string; lifetime_commission_cents: string; approved_at: string;
}

interface Application {
  id: string; user_id: string; email: string; username: string; requested_code: string | null;
  display_name: string | null; country: string | null; socials: Record<string, string>;
  audience_size: number | null; channels: string | null; pitch: string; payout_pref: string | null;
  status: string; created_at: string; spent_cents: number; existing_referrals: number;
  existing_conversions: number; fingerprint_cluster: number; account_created_at: string;
}

interface Payload {
  totals: {
    ambassadors: number; active: number; paused: number; revoked: number;
    pendingApplications: number; attributedSignups: number; convertedSignups: number;
    disqualified: number; ledgerRows: number;
  };
  money: {
    pendingCents: number; releasedCents: number; clawedBackCents: number;
    voidCents: number; attributedGrossCents: number;
  };
  roster: Roster[];
  applications: Application[];
  recentCommissions: any[];
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

export default function AdminAmbassadorPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [appStatus, setAppStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [reviewCode, setReviewCode] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<Payload>("/admin", { method: "POST", body: { action: "ambassadors", appStatus } });
      setData(res);
    } catch (e: any) {
      toast({ title: "Couldn't load ambassadors", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [appStatus, toast]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (key: string, body: any, ok: string) => {
    setBusy(key);
    try {
      const res = await apiFetch<any>("/admin", { method: "POST", body });
      toast({ title: ok, description: res?.code ? `Code: ${res.code}` : undefined });
      await load();
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [load, toast]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> <span className="font-mono-share text-xs">LOADING…</span>
      </div>
    );
  }
  if (!data) return null;

  const { totals, money, roster, applications } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-orbitron text-sm tracking-widest flex items-center gap-2">
          <Award className="w-4 h-4 text-primary" /> AMBASSADOR_PROGRAM
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-[10px] gap-1"
            onClick={() => act("release", { action: "ambassador-release" }, "Release job run")}
            disabled={busy === "release"}>
            {busy === "release" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
            RELEASE_NOW
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[10px] gap-1" onClick={load}>
            <RefreshCw className="w-3 h-3" /> REFRESH
          </Button>
        </div>
      </div>

      {/* Liability first — this is money already owed. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Stat icon={<Clock className="w-3.5 h-3.5" />} label="OWED (ON HOLD)" value={fmt$(money.pendingCents)}
          tone="warn" sub="settled payments, inside hold window" />
        <Stat icon={<DollarSign className="w-3.5 h-3.5" />} label="PAID OUT" value={fmt$(money.releasedCents)}
          tone="neutral" sub="released into cash balances" />
        <Stat icon={<AlertTriangle className="w-3.5 h-3.5" />} label="CLAWED BACK" value={fmt$(money.clawedBackCents)}
          tone="bad" sub={`+ ${fmt$(money.voidCents)} voided`} />
        <Stat icon={<Award className="w-3.5 h-3.5" />} label="REVENUE DRIVEN" value={fmt$(money.attributedGrossCents)}
          tone="good" sub={`${totals.convertedSignups} paying of ${totals.attributedSignups} signups`} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Stat icon={<Users className="w-3.5 h-3.5" />} label="ACTIVE" value={String(totals.active)}
          sub={`${totals.paused} paused · ${totals.revoked} revoked`} />
        <Stat icon={<ShieldAlert className="w-3.5 h-3.5" />} label="DISQUALIFIED" value={String(totals.disqualified)}
          tone={totals.disqualified > 0 ? "warn" : "neutral"} sub="self-referral / alt accounts" />
        <Stat icon={<Award className="w-3.5 h-3.5" />} label="APPLICATIONS" value={String(totals.pendingApplications)}
          tone={totals.pendingApplications > 0 ? "warn" : "neutral"} sub="awaiting review" />
        <Stat icon={<DollarSign className="w-3.5 h-3.5" />} label="LEDGER ROWS" value={String(totals.ledgerRows)}
          sub="commission entries" />
      </div>

      {/* ── Applications ─────────────────────────────────────────────── */}
      <div className="holo-card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-mono-share text-[11px] tracking-widest text-muted-foreground">APPLICATIONS</h3>
          <div className="flex gap-1">
            {(["pending", "approved", "rejected"] as const).map((s) => (
              <button key={s} onClick={() => setAppStatus(s)}
                className={`px-2 py-1 rounded text-[10px] font-mono-share uppercase tracking-wider transition-colors ${
                  appStatus === s ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {applications.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 py-6 text-center font-mono-share">NO {appStatus.toUpperCase()} APPLICATIONS</p>
        ) : (
          <div className="space-y-3">
            {applications.map((a) => {
              // A farmer and a real creator read the same on the pitch alone.
              const suspicious = a.fingerprint_cluster > 3
                || (a.existing_referrals > 25 && a.existing_conversions === 0);
              return (
                <div key={a.id} className={`rounded-lg border p-3 space-y-2 ${
                  suspicious ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-card/40"
                }`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {a.display_name || a.username}
                        {a.country && <span className="ml-2 text-[10px] text-muted-foreground">{a.country}</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono-share truncate">{a.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground font-mono-share">
                        {new Date(a.created_at).toLocaleDateString()}
                      </p>
                      {a.audience_size != null && (
                        <p className="text-[10px] text-muted-foreground font-mono-share">
                          {a.audience_size.toLocaleString()} audience
                        </p>
                      )}
                    </div>
                  </div>

                  {/* The decision signals. */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono-share">
                    <Signal label="EVER PAID" value={fmt$(a.spent_cents)} bad={a.spent_cents === 0} />
                    <Signal label="REFERRALS" value={String(a.existing_referrals)} />
                    <Signal label="CONVERTED" value={String(a.existing_conversions)}
                      bad={a.existing_referrals > 25 && a.existing_conversions === 0} />
                    <Signal label="SAME DEVICE" value={String(a.fingerprint_cluster)} bad={a.fingerprint_cluster > 3} />
                  </div>

                  {suspicious && (
                    <p className="text-[10px] text-destructive flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Matches the farming pattern — high signups with no sales, or an account cluster.
                    </p>
                  )}

                  {a.channels && <p className="text-[11px] text-muted-foreground">Posts on: {a.channels}</p>}
                  <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{a.pitch}</p>

                  {Object.keys(a.socials || {}).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(a.socials).map(([k, v]) => (
                        <a key={k} href={v} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline flex items-center gap-1 font-mono-share">
                          {k} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ))}
                    </div>
                  )}

                  {a.status === "pending" && (
                    <div className="flex items-end gap-2 flex-wrap pt-1">
                      <div className="flex-1 min-w-[140px]">
                        <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Code</label>
                        <Input value={reviewCode[a.id] ?? a.requested_code ?? ""}
                          onChange={(e) => setReviewCode({ ...reviewCode, [a.id]: e.target.value.toUpperCase() })}
                          placeholder="auto" className="h-8 text-xs font-mono bg-muted border-border" />
                      </div>
                      <div className="flex-1 min-w-[140px]">
                        <label className="text-[9px] text-muted-foreground uppercase tracking-wide">
                          Note (shown to applicant)
                        </label>
                        <Input value={reviewNote[a.id] ?? ""}
                          onChange={(e) => setReviewNote({ ...reviewNote, [a.id]: e.target.value })}
                          placeholder="optional" className="h-8 text-xs bg-muted border-border" />
                      </div>
                      <Button size="sm" className="h-8 text-[10px] gap-1 bg-secondary text-secondary-foreground"
                        disabled={busy === a.id}
                        onClick={() => act(a.id, {
                          action: "ambassador-review", id: a.id, decision: "approve",
                          code: reviewCode[a.id] || a.requested_code || undefined,
                          notes: reviewNote[a.id] || undefined,
                        }, "Ambassador approved")}>
                        {busy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        APPROVE
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-[10px] gap-1 border-destructive/40 text-destructive"
                        disabled={busy === a.id}
                        onClick={() => act(a.id, {
                          action: "ambassador-review", id: a.id, decision: "reject",
                          notes: reviewNote[a.id] || undefined,
                        }, "Application rejected")}>
                        <X className="w-3 h-3" /> REJECT
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Roster ───────────────────────────────────────────────────── */}
      <div className="holo-card p-3 sm:p-4 space-y-3">
        <h3 className="font-mono-share text-[11px] tracking-widest text-muted-foreground">ROSTER</h3>
        {roster.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 py-6 text-center font-mono-share">NO AMBASSADORS YET</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono-share">
              <thead>
                <tr className="text-muted-foreground/60 text-left border-b border-border/60">
                  <th className="py-2 pr-3">CODE</th>
                  <th className="py-2 pr-3">WHO</th>
                  <th className="py-2 pr-3 text-right">RATE</th>
                  <th className="py-2 pr-3 text-right">CLICKS</th>
                  <th className="py-2 pr-3 text-right">SIGNUPS</th>
                  <th className="py-2 pr-3 text-right">PAYING</th>
                  <th className="py-2 pr-3 text-right">DRIVEN</th>
                  <th className="py-2 pr-3 text-right">OWED</th>
                  <th className="py-2 pr-3 text-right">BALANCE</th>
                  <th className="py-2 pr-3">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.id} className="border-b border-border/30 last:border-0">
                    <td className="py-2 pr-3">
                      <span className={`font-bold ${r.status === "active" ? "text-primary" : "text-muted-foreground/50"}`}>
                        {r.code}
                      </span>
                      {r.status !== "active" && (
                        <span className="ml-1 text-[9px] uppercase text-amber-400">{r.status}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 truncate max-w-[140px]">{r.display_name || r.username}</td>
                    <td className="py-2 pr-3 text-right">
                      {Number(r.commission_pct)}% / {r.commission_months || "∞"}mo
                    </td>
                    <td className="py-2 pr-3 text-right text-muted-foreground">{r.clicks}</td>
                    <td className="py-2 pr-3 text-right">
                      {r.signups}
                      {r.disqualified > 0 && <span className="text-destructive"> (−{r.disqualified})</span>}
                    </td>
                    <td className="py-2 pr-3 text-right">{r.converted}</td>
                    <td className="py-2 pr-3 text-right text-secondary">{fmt$(Number(r.lifetime_gross_cents))}</td>
                    <td className="py-2 pr-3 text-right text-amber-400">{fmt$(r.pending_cents)}</td>
                    <td className="py-2 pr-3 text-right">{fmt$(r.cash_balance_cents)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex gap-1">
                        <IconBtn title="Extend all commission windows 12 months" disabled={busy === r.id}
                          onClick={() => act(r.id, { action: "ambassador-extend", id: r.id, months: 12, scope: "all" }, "Windows extended")}>
                          <CalendarPlus className="w-3 h-3" />
                        </IconBtn>
                        {r.status === "active" ? (
                          <IconBtn title="Pause — stops new attribution, held money still releases" disabled={busy === r.id}
                            onClick={() => act(r.id, { action: "ambassador-update", id: r.id, status: "paused" }, "Paused")}>
                            <Pause className="w-3 h-3" />
                          </IconBtn>
                        ) : r.status === "paused" ? (
                          <IconBtn title="Reactivate" disabled={busy === r.id}
                            onClick={() => act(r.id, { action: "ambassador-update", id: r.id, status: "active" }, "Reactivated")}>
                            <Play className="w-3 h-3" />
                          </IconBtn>
                        ) : null}
                        {r.status !== "revoked" && (
                          <IconBtn danger title="Revoke — voids everything still on hold" disabled={busy === r.id}
                            onClick={() => {
                              if (!confirm(`Revoke ${r.code}? This voids ${fmt$(r.pending_cents)} still on hold. Already-released cash is not reversed.`)) return;
                              act(r.id, { action: "ambassador-update", id: r.id, status: "revoked" }, "Revoked");
                            }}>
                            <Ban className="w-3 h-3" />
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recent commission ────────────────────────────────────────── */}
      {data.recentCommissions.length > 0 && (
        <div className="holo-card p-3 sm:p-4 space-y-3">
          <h3 className="font-mono-share text-[11px] tracking-widest text-muted-foreground">RECENT_COMMISSION</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono-share">
              <thead>
                <tr className="text-muted-foreground/60 text-left border-b border-border/60">
                  <th className="py-2 pr-3">WHEN</th>
                  <th className="py-2 pr-3">CODE</th>
                  <th className="py-2 pr-3">KIND</th>
                  <th className="py-2 pr-3 text-right">GROSS</th>
                  <th className="py-2 pr-3 text-right">RATE</th>
                  <th className="py-2 pr-3 text-right">COMMISSION</th>
                  <th className="py-2 pr-3">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.recentCommissions.map((c: any) => (
                  <tr key={c.id} className="border-b border-border/30 last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-primary">{c.code || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{c.source_kind}</td>
                    <td className="py-2 pr-3 text-right">{fmt$(c.gross_cents)}</td>
                    <td className="py-2 pr-3 text-right text-muted-foreground">{Number(c.commission_pct)}%</td>
                    <td className="py-2 pr-3 text-right">{fmt$(c.commission_cents)}</td>
                    <td className="py-2 pr-3">
                      <span className={
                        c.status === "available" ? "text-secondary"
                        : c.status === "pending" ? "text-amber-400"
                        : "text-destructive"
                      }>
                        {c.status}
                        {c.status === "pending" && c.available_at &&
                          ` → ${new Date(c.available_at).toLocaleDateString()}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Signal({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`rounded px-2 py-1 ${bad ? "bg-destructive/15 text-destructive" : "bg-muted/40 text-muted-foreground"}`}>
      <div className="text-[9px] opacity-70 tracking-wider">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger, disabled }: {
  children: React.ReactNode; onClick: () => void; title: string; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
        danger ? "text-destructive hover:bg-destructive/15" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}>
      {children}
    </button>
  );
}

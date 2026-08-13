/**
 * /ambassador — apply to the program, then the earnings dashboard once approved.
 *
 * Deliberately separate from /referral. That page is the open credit-reward
 * system anyone can use; this one pays cash and is approval-gated, and blurring
 * the two would make it look like everyone earns commission.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Award, Copy, Check, DollarSign, Users, MousePointerClick,
  Clock, TrendingUp, Link2, Share2, ShieldAlert, Wallet, Send, Loader2,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import CyberLayout from "@/components/CyberLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { BRAND } from "@/lib/brand";

const money = (cents: number) => `$${((cents || 0) / 100).toFixed(2)}`;

interface Mine {
  ambassador: {
    code: string; displayName: string | null; status: string;
    commissionPct: number; commissionMonths: number; holdDays: number; tier: string;
    lifetimeGrossCents: number; lifetimeCommissionCents: number; approvedAt: string;
  } | null;
  application: {
    status: string; requestedCode: string | null; adminNotes: string | null;
    createdAt: string; reviewedAt: string | null;
  } | null;
}

interface Stats {
  code: string; status: string; commissionPct: number; commissionMonths: number; holdDays: number;
  signups: number; converted: number; earning: number; disqualified: number;
  attributedGrossCents: number; pendingCents: number; releasedCents: number;
  clawedBackCents: number; pendingCount: number; nextReleaseAt: string | null;
  withdrawableCents: number; clicks: number; uniqueClicks: number; conversionPct: number;
  earningsSeries: { bucket: string; commission_cents: number; gross_cents: number }[];
}

interface Referee {
  name: string; joinedAt: string; commissionUntil: string | null; firstPaidAt: string | null;
  grossCents: number; commissionCents: number; disqualified: boolean;
}

export default function AmbassadorPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [mine, setMine] = useState<Mine | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [referees, setReferees] = useState<Referee[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Application form
  const [form, setForm] = useState({
    requestedCode: "", displayName: "", country: "", audienceSize: "",
    channels: "", pitch: "", youtube: "", tiktok: "", x: "", instagram: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    try {
      const m = await apiFetch<Mine>("/ambassador", { method: "POST", body: { action: "mine" } });
      setMine(m);
      if (m.ambassador) {
        const [s, r] = await Promise.all([
          apiFetch<Stats>("/ambassador", { method: "POST", body: { action: "stats" } }),
          apiFetch<{ referees: Referee[] }>("/ambassador", { method: "POST", body: { action: "referees" } }),
        ]);
        setStats(s);
        setReferees(r.referees || []);
      }
    } catch {
      /* leave the empty state up */
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { load(); }, [load]);

  const link = stats?.code ? `${BRAND.publicUrl}/r/${stats.code}` : "";

  const copy = useCallback(() => {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast({ title: "Link copied", description: "Anyone who signs up through it is attributed to you." });
    setTimeout(() => setCopied(false), 2000);
  }, [link, toast]);

  const submit = useCallback(async () => {
    if (form.pitch.trim().length < 30) {
      toast({ title: "Tell us a bit more", description: "At least 30 characters about how you'd promote.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const socials: Record<string, string> = {};
      for (const k of ["youtube", "tiktok", "x", "instagram"] as const) {
        if (form[k].trim()) socials[k] = form[k].trim();
      }
      await apiFetch("/ambassador", {
        method: "POST",
        body: {
          action: "apply",
          requestedCode: form.requestedCode || undefined,
          displayName: form.displayName || undefined,
          country: form.country || undefined,
          audienceSize: form.audienceSize ? Number(form.audienceSize) : undefined,
          channels: form.channels || undefined,
          pitch: form.pitch,
          socials,
        },
      });
      toast({ title: "Application submitted", description: "You'll hear back once it's reviewed." });
      await load();
    } catch (e: any) {
      toast({ title: "Couldn't submit", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [form, toast, load]);

  const chart = useMemo(
    () => (stats?.earningsSeries || []).map((p) => ({
      label: new Date(p.bucket).toLocaleDateString(undefined, { month: "short" }),
      commission: p.commission_cents / 100,
    })),
    [stats],
  );

  // ── Gates ──────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <CyberLayout>
        <Shell onBack={() => navigate(-1)}>
          <Card className="p-6 text-center space-y-4 border-border bg-card">
            <Award className="w-12 h-12 mx-auto text-primary opacity-60" />
            <p className="text-muted-foreground text-sm">Sign in to apply for the ambassador program</p>
            <Button onClick={() => navigate("/")} className="bg-primary text-primary-foreground font-semibold">Sign In</Button>
          </Card>
        </Shell>
      </CyberLayout>
    );
  }

  if (loading) {
    return (
      <CyberLayout>
        <Shell onBack={() => navigate(-1)}>
          <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-24 rounded bg-muted animate-pulse" />)}</div>
        </Shell>
      </CyberLayout>
    );
  }

  const app = mine?.application;
  const amb = mine?.ambassador;

  // ── Approved: dashboard ────────────────────────────────────────────
  if (amb && stats) {
    return (
      <CyberLayout>
        <Shell onBack={() => navigate(-1)}>
          {amb.status !== "active" && (
            <Card className="p-3 border-yellow-500/40 bg-yellow-500/10 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-200">
                Your account is <span className="font-bold uppercase">{amb.status}</span>. New signups aren't being
                attributed right now. Commission already on hold still pays out on schedule.
              </p>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Stat icon={Wallet} label="Withdrawable" value={money(stats.withdrawableCents)} accent="text-green-400" />
            <Stat icon={Clock} label="On hold" value={money(stats.pendingCents)} accent="text-yellow-400"
              sub={stats.nextReleaseAt ? `next ${new Date(stats.nextReleaseAt).toLocaleDateString()}` : undefined} />
            <Stat icon={DollarSign} label="Paid out to date" value={money(stats.releasedCents)} accent="text-primary" />
            <Stat icon={TrendingUp} label="Revenue driven" value={money(stats.attributedGrossCents)} accent="text-secondary" />
          </div>

          <Card className="p-4 border-border bg-card space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="w-4 h-4 text-primary" /> Your ambassador link
            </div>
            <div className="flex gap-2">
              <div className="flex-1 bg-muted rounded px-3 py-2 text-xs text-muted-foreground font-mono truncate border border-border">
                {link}
              </div>
              <Button size="sm" variant="outline" onClick={copy} className="shrink-0 border-border">
                {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <Button
              onClick={() => navigator.share ? navigator.share({ title: `Join ${BRAND.name}`, url: link }) : copy()}
              className="w-full bg-primary text-primary-foreground font-semibold gap-2"
            >
              <Share2 className="w-4 h-4" /> Share link
            </Button>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              You earn <span className="text-primary font-bold">{amb.commissionPct}%</span> of everything your referred
              customers pay, for {amb.commissionMonths > 0 ? `${amb.commissionMonths} months each` : "as long as they stay"}.
              Commission is held {amb.holdDays} days before it becomes withdrawable, so refunds can settle first.
            </p>
          </Card>

          <div className="grid grid-cols-4 gap-2">
            <Mini icon={MousePointerClick} label="Clicks" value={stats.uniqueClicks} />
            <Mini icon={Users} label="Signups" value={stats.signups} />
            <Mini icon={DollarSign} label="Paying" value={stats.converted} />
            <Mini icon={TrendingUp} label="Conv." value={`${stats.conversionPct.toFixed(1)}%`} />
          </div>

          <Card className="p-4 border-border bg-card">
            <h2 className="text-sm font-semibold text-foreground mb-3">Commission earned</h2>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="ambFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Commission"]}
                />
                <Area type="monotone" dataKey="commission" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#ambFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {stats.clawedBackCents > 0 && (
            <Card className="p-3 border-border bg-card flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Reversed by refunds or chargebacks</span>
              <span className="text-xs font-mono text-destructive">−{money(stats.clawedBackCents)}</span>
            </Card>
          )}

          <Card className="p-4 border-border bg-card space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Your customers</h2>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={() => navigate("/profile")}>
                <Send className="w-3 h-3" /> Withdraw
              </Button>
            </div>
            {referees.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No signups yet. Share your link to get started.
              </p>
            ) : (
              <div className="space-y-1">
                {referees.map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs text-foreground truncate">
                        {r.name}
                        {r.disqualified && <span className="ml-2 text-[9px] text-destructive uppercase">excluded</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(r.joinedAt).toLocaleDateString()}
                        {r.commissionUntil && ` · earns until ${new Date(r.commissionUntil).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0 pl-2">
                      <p className="text-xs font-mono text-primary">{money(r.commissionCents)}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">of {money(r.grossCents)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Shell>
      </CyberLayout>
    );
  }

  // ── Applied, awaiting review ───────────────────────────────────────
  if (app?.status === "pending") {
    return (
      <CyberLayout>
        <Shell onBack={() => navigate(-1)}>
          <Card className="p-6 text-center space-y-3 border-primary/40 bg-primary/5">
            <Loader2 className="w-10 h-10 mx-auto text-primary animate-spin" />
            <h2 className="text-sm font-bold text-foreground">Application under review</h2>
            <p className="text-xs text-muted-foreground">
              Submitted {new Date(app.createdAt).toLocaleDateString()}. We review each one by hand — you'll get an
              answer here.
            </p>
            {app.requestedCode && (
              <p className="text-[10px] text-muted-foreground font-mono">Requested code: {app.requestedCode}</p>
            )}
          </Card>
        </Shell>
      </CyberLayout>
    );
  }

  // ── Rejected ───────────────────────────────────────────────────────
  if (app?.status === "rejected") {
    return (
      <CyberLayout>
        <Shell onBack={() => navigate(-1)}>
          <Card className="p-6 space-y-3 border-border bg-card text-center">
            <h2 className="text-sm font-bold text-foreground">Application not accepted</h2>
            {app.adminNotes && <p className="text-xs text-muted-foreground italic">"{app.adminNotes}"</p>}
            <p className="text-xs text-muted-foreground">
              The regular referral program is still open to you and pays credits on every signup that buys.
            </p>
            <Button variant="outline" className="border-border" onClick={() => navigate("/referral")}>
              Go to referral program
            </Button>
          </Card>
        </Shell>
      </CyberLayout>
    );
  }

  // ── Not applied: pitch + form ──────────────────────────────────────
  return (
    <CyberLayout>
      <Shell onBack={() => navigate(-1)}>
        <Card className="p-4 border-primary/40 bg-primary/5 space-y-2">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" /> Earn 20% in cash
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ambassadors get a personal link and earn <span className="text-primary font-bold">20% of everything</span> their
            referred customers pay — for 12 months per customer, renewable on review. Real money, withdrawable to your
            bank, PayPal or XRGE.
          </p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Commission is held 30 days before it becomes withdrawable so refunds and chargebacks can settle. Signups that
            look like your own alt accounts don't earn.
          </p>
        </Card>

        <Card className="p-4 border-border bg-card space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Apply</h2>

          <Field label="Your link code" hint="Letters, numbers, dashes. Leave blank and we'll assign one.">
            <Input value={form.requestedCode}
              onChange={(e) => setForm({ ...form, requestedCode: e.target.value.toUpperCase() })}
              placeholder="NEONKING" maxLength={24} className="font-mono text-xs bg-muted border-border" />
          </Field>
          {form.requestedCode && (
            <p className="text-[10px] text-muted-foreground font-mono -mt-1">
              {BRAND.publicUrl}/r/{form.requestedCode}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Name / handle">
              <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="How you're known" className="text-xs bg-muted border-border" />
            </Field>
            <Field label="Country">
              <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="US" className="text-xs bg-muted border-border" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="YouTube"><Input value={form.youtube} onChange={(e) => setForm({ ...form, youtube: e.target.value })} placeholder="URL" className="text-xs bg-muted border-border" /></Field>
            <Field label="TikTok"><Input value={form.tiktok} onChange={(e) => setForm({ ...form, tiktok: e.target.value })} placeholder="URL" className="text-xs bg-muted border-border" /></Field>
            <Field label="X"><Input value={form.x} onChange={(e) => setForm({ ...form, x: e.target.value })} placeholder="URL" className="text-xs bg-muted border-border" /></Field>
            <Field label="Instagram"><Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="URL" className="text-xs bg-muted border-border" /></Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Audience size">
              <Input type="number" value={form.audienceSize} onChange={(e) => setForm({ ...form, audienceSize: e.target.value })}
                placeholder="12000" className="text-xs bg-muted border-border" />
            </Field>
            <Field label="Where you'd post">
              <Input value={form.channels} onChange={(e) => setForm({ ...form, channels: e.target.value })}
                placeholder="youtube, discord" className="text-xs bg-muted border-border" />
            </Field>
          </div>

          <Field label="How would you promote it?" hint="Be specific — this is what the decision turns on.">
            <Textarea value={form.pitch} onChange={(e) => setForm({ ...form, pitch: e.target.value })}
              rows={4} maxLength={4000} placeholder="I run an AI art channel and my viewers constantly ask which tools I use…"
              className="text-xs bg-muted border-border resize-none" />
          </Field>

          <Button onClick={submit} disabled={submitting}
            className="w-full bg-primary text-primary-foreground font-semibold gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
            Submit application
          </Button>
        </Card>
      </Shell>
    </CyberLayout>
  );
}

// ── Presentational bits ──────────────────────────────────────────────
function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="text-muted-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold font-[Orbitron] text-foreground tracking-wider flex items-center gap-2">
            <Award className="w-5 h-5 text-primary" /> AMBASSADORS
          </h1>
          <p className="text-xs text-muted-foreground">Earn cash on the revenue you bring in</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent, sub }: {
  icon: any; label: string; value: string; accent: string; sub?: string;
}) {
  return (
    <Card className="p-3 border-border bg-card">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        <Icon className={`w-3 h-3 ${accent}`} /> {label}
      </div>
      <p className={`text-lg font-bold font-mono mt-1 ${accent}`}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function Mini({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <Card className="p-2 border-border bg-card text-center">
      <Icon className="w-3 h-3 mx-auto text-muted-foreground" />
      <p className="text-sm font-bold font-mono text-foreground mt-1">{value}</p>
      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[9px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

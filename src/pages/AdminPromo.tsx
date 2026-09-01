/**
 * /admin/promo — the review queue for the anti-farm promo.
 *
 * A list of pending claims with everything needed to judge one: the post link,
 * how old the account is, how many renders it has, and whether it has already
 * been paid. Approve pays; reject doesn't. Nothing here is automatic.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2, Check, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Claim {
  id: string;
  userId: string;
  email: string;
  postUrl: string;
  status: string;
  creditsAwarded: number;
  rejectReason: string | null;
  createdAt: string;
  accountCreatedAt: string;
  accountAgeDays: number;
  renderCount: number;
  alreadyPaid: boolean;
  meetsAge: boolean;
  meetsRenders: boolean;
}

interface Payload {
  config: { maxApproved: number; creditAmount: number; minAccountAgeDays: number; minRenders: number };
  approvedCount: number;
  slotsRemaining: number;
  claims: Claim[];
}

const TABS = ["pending", "approved", "rejected", "all"] as const;

export default function AdminPromo() {
  const { toast } = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>("pending");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      setData(await apiFetch<Payload>(`/admin/promo?status=${status}`));
      setDenied(false);
    } catch (e: any) {
      if (String(e?.message || "").toLowerCase().includes("admin")) setDenied(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Promo review — GLTCH Runner";
    load(tab);
  }, [tab, load]);

  const decide = async (claim: Claim, action: "approve" | "reject") => {
    if (busy) return;
    if (action === "approve" && !window.confirm(
      `Pay ${data?.config.creditAmount} credits to ${claim.email}?`,
    )) return;
    const reason = action === "reject"
      ? window.prompt("Reason (optional, shown to the user):") ?? ""
      : "";
    setBusy(claim.id);
    try {
      const r = await apiFetch<{ promoClosed?: boolean; slotsRemaining?: number }>("/admin/promo", {
        method: "POST",
        body: { claimId: claim.id, action, reason },
      });
      toast({
        title: action === "approve" ? "Approved and paid" : "Rejected",
        description: action === "approve"
          ? r.promoClosed
            ? "That was the last spot — the promo is now closed."
            : `${r.slotsRemaining} spots left.`
          : undefined,
      });
      await load(tab);
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (denied) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground p-8">
        <p className="font-mono text-sm text-destructive">Admin only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/30 bg-card/40 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center gap-3 flex-wrap">
          <Link to="/admin" className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary">
            <ArrowLeft className="w-3.5 h-3.5" /> ADMIN
          </Link>
          <span className="text-border/60">/</span>
          <h1 className="font-orbitron text-xs tracking-wider text-primary">PROMO_REVIEW</h1>
          {data && (
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {data.approvedCount}/{data.config.maxApproved} paid · {data.slotsRemaining} left ·{" "}
              {data.config.creditAmount} cr each
            </span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-6 space-y-4">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg font-mono text-[11px] tracking-wider border transition-colors ${tab === t
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-muted/30 border-border/40 text-muted-foreground hover:border-primary/20"
                }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {loading && <Loader2 className="w-5 h-5 animate-spin text-primary" />}

        {!loading && data?.claims.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground">Nothing {tab === "all" ? "here" : tab}.</p>
        )}

        {!loading && data?.claims.map((c) => (
          <div key={c.id} className="border border-border/40 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1 min-w-0">
                <a
                  href={c.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary underline break-all inline-flex items-center gap-1"
                >
                  {c.postUrl} <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
                <p className="font-mono text-[11px] text-muted-foreground break-all">{c.email}</p>
              </div>
              <span className={`font-mono text-[10px] tracking-wider px-2 py-0.5 rounded shrink-0 ${c.status === "approved" ? "bg-green-500/15 text-green-400"
                : c.status === "rejected" ? "bg-destructive/15 text-destructive"
                  : "bg-primary/15 text-primary"
                }`}>
                {c.status.toUpperCase()}
              </span>
            </div>

            <div className="flex gap-4 flex-wrap font-mono text-[11px]">
              <span className={c.meetsAge ? "text-foreground/70" : "text-yellow-400"}>
                {c.meetsAge ? "✓" : "✗"} {c.accountAgeDays}d old
                <span className="text-muted-foreground"> (need {data.config.minAccountAgeDays})</span>
              </span>
              <span className={c.meetsRenders ? "text-foreground/70" : "text-yellow-400"}>
                {c.meetsRenders ? "✓" : "✗"} {c.renderCount} renders
                <span className="text-muted-foreground"> (need {data.config.minRenders})</span>
              </span>
              {c.alreadyPaid && <span className="text-destructive">ALREADY PAID</span>}
              <span className="text-muted-foreground">
                claimed {new Date(c.createdAt).toLocaleDateString()}
              </span>
            </div>

            {c.rejectReason && (
              <p className="font-mono text-[11px] text-muted-foreground">reason: {c.rejectReason}</p>
            )}

            {c.status === "pending" && (
              <div className="flex gap-2">
                <button
                  onClick={() => decide(c, "approve")}
                  disabled={busy === c.id || c.alreadyPaid || data.slotsRemaining <= 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] border border-green-500/40 text-green-400 hover:bg-green-500/10 disabled:opacity-40 transition-colors"
                >
                  {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  APPROVE +{data.config.creditAmount}
                </button>
                <button
                  onClick={() => decide(c, "reject")}
                  disabled={busy === c.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                >
                  <X className="w-3 h-3" /> REJECT
                </button>
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}

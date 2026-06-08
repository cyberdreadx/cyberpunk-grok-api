import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { DollarSign, Coins, Heart, TrendingUp, Loader2, Wallet, ArrowDownToLine, Zap, BadgeCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import VerificationDialog from "@/components/VerificationDialog";

interface EarningsSummary {
  totalCreditsEarned: number;
  creatorShareCredits: number;
  totalCentsEarned: number;
  creatorShareCents: number;
  charityCredits: number;
  charityCents: number;
  cashBalanceCents: number;
  chatEarningsCents: number;
  chatMessages: number;
  chatMedia: number;
  postUnlocks: number;
  storyUnlocks: number;
  totalXrgeEarned: number;
  creatorShareXrge: number;
  xrgeUnlocks: number;
}

interface RecentTx {
  type: "post" | "story";
  creditsPaid: number;
  centsPaid: number;
  xrgePaid?: string;
  buyerName: string;
  unlockedAt: string;
}

interface PayoutRequest {
  id: string;
  amount_cents: number;
  method: string;
  payout_details: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

interface EarningsData {
  summary: EarningsSummary;
  recent: RecentTx[];
}

interface PayoutData {
  cashBalanceCents: number;
  minPayoutCents: number;
  requests: PayoutRequest[];
}

const EarningsPanel: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [data, setData] = useState<EarningsData | null>(null);
  const [payoutData, setPayoutData] = useState<PayoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState<"xrge" | "paypal" | "bank" | "crypto">("xrge");
  const [withdrawDetails, setWithdrawDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const isVerified = !!user?.is_verified;
  const verificationStatus = user?.verification_status || "unverified";

  const fetchData = useCallback(async () => {
    try {
      const [earnings, payouts] = await Promise.all([
        apiFetch<EarningsData>("/earnings"),
        apiFetch<PayoutData>("/payouts").catch(() => null),
      ]);
      setData(earnings);
      setPayoutData(payouts);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleWithdraw = async () => {
    const isXrge = withdrawMethod === "xrge";
    const minCents = isXrge ? 100 : (payoutData?.minPayoutCents || 2500);
    const cents = Math.round(parseFloat(withdrawAmount) * 100);
    if (!cents || cents < minCents) {
      toast({ title: `Minimum withdrawal is $${(minCents / 100).toFixed(2)}`, variant: "destructive" });
      return;
    }
    if (!isXrge && !withdrawDetails.trim()) {
      toast({ title: "Enter your payout details", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<any>("/payouts", {
        method: "POST",
        body: { amountCents: cents, method: withdrawMethod, payoutDetails: isXrge ? "" : withdrawDetails.trim() },
      });
      if (result.instant) {
        toast({ title: `Instant payout! ${result.xrgeAmount} XRGE added to your bank` });
      } else {
        toast({ title: "Withdrawal request submitted!" });
      }
      setShowWithdraw(false);
      setWithdrawAmount("");
      setWithdrawDetails("");
      fetchData();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show verification CTA even with no earnings yet — but only if user is unverified.
  // Hide entirely only when both no earnings AND already verified (nothing useful to show).
  const noEarnings = !data || (data.summary.postUnlocks === 0 && data.summary.storyUnlocks === 0 && data.summary.xrgeUnlocks === 0 && (data.summary.chatEarningsCents || 0) === 0);
  if (noEarnings && isVerified) {
    return null;
  }
  if (noEarnings) {
    // Render JUST the verification banner
    return (
      <div className="bg-card/60 border border-border/40 rounded-lg p-4 space-y-3">
        <div className="bg-primary/5 border border-primary/30 rounded-md p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-orbitron text-[11px] text-primary">
                {verificationStatus === "pending" ? "VERIFICATION IN PROGRESS" :
                 verificationStatus === "lapsed" ? "VERIFICATION LAPSED" :
                 "GET VERIFIED TO MONETIZE"}
              </p>
              <p className="font-mono-share text-[10px] text-muted-foreground mt-0.5">
                Identity verification is required to set prices on posts/stories or request payouts.
              </p>
            </div>
          </div>
          <Button onClick={() => setVerifyOpen(true)} size="sm" className="w-full font-mono-share text-[10px]">
            <BadgeCheck className="w-3.5 h-3.5 mr-2" />
            {verificationStatus === "pending" ? "CONTINUE VERIFICATION" :
             verificationStatus === "lapsed" ? "RE-ACTIVATE" :
             "GET VERIFIED"}
          </Button>
        </div>
        <VerificationDialog open={verifyOpen} onOpenChange={setVerifyOpen} />
      </div>
    );
  }

  const s = data.summary;
  const fmtCents = (c: number) => `$${(c / 100).toFixed(2)}`;
  const hasPending = payoutData?.requests?.some((r) => r.status === "pending");
  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-400",
    approved: "bg-blue-500/20 text-blue-400",
    paid: "bg-green-500/20 text-green-400",
    rejected: "bg-destructive/20 text-destructive",
  };

  return (
    <div className="bg-card/60 border border-border/40 rounded-lg p-4 space-y-4">
      <h2 className="font-orbitron text-xs text-muted-foreground tracking-widest flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5" /> CREATOR EARNINGS
        {isVerified && <BadgeCheck className="w-3.5 h-3.5 text-primary" />}
      </h2>

      {/* Verification banner — required for monetization & payouts */}
      {!isVerified && (
        <div className="bg-primary/5 border border-primary/30 rounded-md p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-orbitron text-[11px] text-primary">
                {verificationStatus === "pending" ? "VERIFICATION IN PROGRESS" :
                 verificationStatus === "lapsed" ? "VERIFICATION LAPSED" :
                 "GET VERIFIED TO MONETIZE"}
              </p>
              <p className="font-mono-share text-[10px] text-muted-foreground mt-0.5">
                {verificationStatus === "pending"
                  ? "Finish payment + ID check to enable payouts and priced posts."
                  : verificationStatus === "lapsed"
                  ? "Your verification subscription lapsed. Restart to re-enable monetization."
                  : "Identity verification is required to set prices on posts/stories or request payouts."}
              </p>
            </div>
          </div>
          <Button
            onClick={() => setVerifyOpen(true)}
            size="sm"
            className="w-full font-mono-share text-[10px]"
          >
            <BadgeCheck className="w-3.5 h-3.5 mr-2" />
            {verificationStatus === "pending" ? "CONTINUE VERIFICATION" :
             verificationStatus === "lapsed" ? "RE-ACTIVATE" :
             "GET VERIFIED"}
          </Button>
        </div>
      )}

      <VerificationDialog open={verifyOpen} onOpenChange={setVerifyOpen} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Coins className="w-3 h-3 text-primary" />
            <span className="font-mono-share text-[9px] text-muted-foreground">CREDITS EARNED</span>
          </div>
          <div className="font-orbitron text-lg text-foreground">{s.creatorShareCredits}</div>
          <div className="font-mono-share text-[9px] text-muted-foreground">{s.postUnlocks + s.storyUnlocks} unlocks</div>
        </div>

        {/* Cash balance — withdrawable */}
        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet className="w-3 h-3 text-green-400" />
            <span className="font-mono-share text-[9px] text-muted-foreground">CASH BALANCE</span>
          </div>
          <div className="font-orbitron text-lg text-green-400">{fmtCents(s.cashBalanceCents)}</div>
          <div className="font-mono-share text-[9px] text-muted-foreground">available to withdraw</div>
        </div>

        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Heart className="w-3 h-3 text-pink-400" />
            <span className="font-mono-share text-[9px] text-muted-foreground">CHARITY DONATED</span>
          </div>
          <div className="font-orbitron text-sm text-pink-400">
            {s.charityCredits > 0 && `${s.charityCredits} cr`}
            {s.charityCredits > 0 && s.charityCents > 0 && " + "}
            {s.charityCents > 0 && fmtCents(s.charityCents)}
            {s.charityCredits === 0 && s.charityCents === 0 && "0"}
          </div>
          <div className="font-mono-share text-[9px] text-muted-foreground">5% to reforestation & orphans</div>
        </div>

        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 text-primary" />
            <span className="font-mono-share text-[9px] text-muted-foreground">TOTAL EARNED</span>
          </div>
          <div className="font-mono-share text-[10px] text-foreground space-y-0.5">
            <div>{fmtCents(s.creatorShareCents)} cash</div>
            <div>{s.creatorShareCredits} credits</div>
          </div>
        </div>
      </div>

      {/* XRGE earnings card */}
      {(s.xrgeUnlocks > 0 || s.creatorShareXrge > 0) && (
        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3 h-3 text-secondary" />
            <span className="font-mono-share text-[9px] text-muted-foreground tracking-widest">XRGE EARNINGS</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-orbitron text-lg text-secondary">{s.creatorShareXrge.toFixed(2)}</span>
            <span className="font-mono-share text-[10px] text-muted-foreground">XRGE (80% of {s.totalXrgeEarned.toFixed(2)})</span>
          </div>
          <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5">
            {s.xrgeUnlocks} unlock{s.xrgeUnlocks !== 1 ? "s" : ""} · instant to your bank
          </div>
        </div>
      )}

      {/* Chat persona earnings card */}
      {(s.chatEarningsCents > 0 || s.chatMessages > 0 || s.chatMedia > 0) && (
        <div className="bg-background/50 rounded-md p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 text-green-400" />
            <span className="font-mono-share text-[9px] text-muted-foreground tracking-widest">CHAT EARNINGS</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-orbitron text-lg text-green-400">{fmtCents(s.chatEarningsCents)}</span>
            <span className="font-mono-share text-[10px] text-muted-foreground">75% of fan spend</span>
          </div>
          <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5">
            {s.chatMessages} paid message{s.chatMessages !== 1 ? "s" : ""} · {s.chatMedia} photo/video{s.chatMedia !== 1 ? "s" : ""} sent
          </div>
        </div>
      )}

      {/* Withdraw button */}
      {s.cashBalanceCents >= 100 && !hasPending && isVerified && (
        <Button
          onClick={() => setShowWithdraw(!showWithdraw)}
          className="w-full font-mono-share text-xs"
          variant="outline"
        >
          <ArrowDownToLine className="w-3.5 h-3.5 mr-2" />
          REQUEST WITHDRAWAL
        </Button>
      )}
      {s.cashBalanceCents >= 100 && !hasPending && !isVerified && (
        <p className="font-mono-share text-[10px] text-muted-foreground text-center italic">
          Get verified to withdraw your ${(s.cashBalanceCents / 100).toFixed(2)}.
        </p>
      )}

      {s.cashBalanceCents > 0 && s.cashBalanceCents < 100 && (
        <p className="font-mono-share text-[9px] text-muted-foreground text-center">
          Min. withdrawal: $1.00 (XRGE instant) — you need {fmtCents(100 - s.cashBalanceCents)} more
        </p>
      )}

      {/* Withdraw form */}
      {showWithdraw && (
        <div className="bg-background/50 border border-border/30 rounded-md p-3 space-y-3">
          <h3 className="font-mono-share text-[10px] text-muted-foreground tracking-widest">WITHDRAW FUNDS</h3>

          <div>
            <label className="font-mono-share text-[9px] text-muted-foreground">PAYOUT METHOD</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(["xrge", "paypal", "bank", "crypto"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setWithdrawMethod(m)}
                  className={`px-3 py-1.5 rounded text-[10px] font-mono-share border transition-colors flex items-center gap-1 ${
                    withdrawMethod === m
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/30 text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {m === "xrge" && <Zap className="w-3 h-3" />}
                  {m === "xrge" ? "$XRGE INSTANT" : m.toUpperCase()}
                </button>
              ))}
            </div>
            {withdrawMethod === "xrge" && (
              <p className="font-mono-share text-[8px] text-primary/70 mt-1">
                ⚡ Instant — converts cash to XRGE at live rate, credited to your XRGE bank. Min $1.00
              </p>
            )}
            {withdrawMethod !== "xrge" && (
              <p className="font-mono-share text-[8px] text-muted-foreground mt-1">
                Manual review — processed within 48h. Min $25.00
              </p>
            )}
          </div>

          <div>
            <label className="font-mono-share text-[9px] text-muted-foreground">AMOUNT (USD)</label>
            <Input
              type="number"
              min={0.01}
              step={0.01}
              max={(s.cashBalanceCents / 100)}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder={withdrawMethod === "xrge" ? "Min $1.00" : `Min $${((payoutData?.minPayoutCents || 2500) / 100).toFixed(2)}`}
              className="h-8 font-mono-share text-sm bg-input/50"
            />
          </div>

          {withdrawMethod !== "xrge" && (
            <div>
              <label className="font-mono-share text-[9px] text-muted-foreground">
                {withdrawMethod === "paypal" ? "PAYPAL EMAIL" : withdrawMethod === "bank" ? "BANK DETAILS" : "WALLET ADDRESS"}
              </label>
              <Input
                value={withdrawDetails}
                onChange={(e) => setWithdrawDetails(e.target.value)}
                placeholder={
                  withdrawMethod === "paypal" ? "your@email.com" : withdrawMethod === "bank" ? "Routing + Account number" : "0x... or wallet address"
                }
                className="h-8 font-mono-share text-sm bg-input/50"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleWithdraw} disabled={submitting} className="font-mono-share text-[10px]">
              {submitting ? "PROCESSING..." : withdrawMethod === "xrge" ? "⚡ INSTANT PAYOUT" : "SUBMIT REQUEST"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowWithdraw(false)} className="font-mono-share text-[10px]">
              CANCEL
            </Button>
          </div>
        </div>
      )}

      {/* Payout history */}
      {payoutData && payoutData.requests.length > 0 && (
        <div>
          <h3 className="font-mono-share text-[9px] text-muted-foreground mb-2 tracking-widest">PAYOUT HISTORY</h3>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {payoutData.requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-[10px] font-mono-share py-1 px-2 bg-background/30 rounded">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${STATUS_COLORS[r.status] || ""}`}>
                    {r.status.toUpperCase()}
                  </span>
                  <span className="text-foreground">{fmtCents(r.amount_cents)}</span>
                  <span className="text-muted-foreground">{r.method}</span>
                </div>
                <span className="text-muted-foreground">{timeAgo(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent sales */}
      {data.recent.length > 0 && (
        <div>
          <h3 className="font-mono-share text-[9px] text-muted-foreground mb-2 tracking-widest">RECENT SALES</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {data.recent.map((tx, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] font-mono-share py-1 px-2 bg-background/30 rounded">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${tx.type === "post" ? "bg-primary/20 text-primary" : "bg-accent/20 text-accent-foreground"}`}>
                    {tx.type.toUpperCase()}
                  </span>
                  <span className="text-muted-foreground truncate">{tx.buyerName}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-foreground">
                    {tx.xrgePaid && parseFloat(tx.xrgePaid) > 0
                      ? `${(parseFloat(tx.xrgePaid) * 0.8).toFixed(2)} XRGE`
                      : tx.creditsPaid > 0 ? `${Math.floor(tx.creditsPaid * 0.75)} cr` : fmtCents(Math.floor(tx.centsPaid * 0.75))}
                  </span>
                  <span className="text-muted-foreground">{timeAgo(tx.unlockedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EarningsPanel;

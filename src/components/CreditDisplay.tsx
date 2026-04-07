import React, { useState, useEffect, useCallback } from "react";
import { Coins, ShoppingCart, Loader2, Crown, Settings, XCircle, AlertTriangle, Share2, Copy, Check, Gift, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import PricingCards from "@/components/PricingCards";
import XrgePaymentDialog from "@/components/XrgePaymentDialog";
import XrgeBankDialog from "@/components/XrgeBankDialog";
import type { CreditPackage, SubscriptionTier } from "@/lib/api";
import { XRGE_DEXSCREENER_URL, XRGE_CHAIN_NAME } from "@/lib/xrgePublic";

interface CreditDisplayProps {
  totalCredits: number;
  dailyCredits: number;
  subCredits: number;
  packCredits: number;
  subscriptionTier: string | null;
  subscriptionRenewsAt: string | null;
  subscriptionCancelAt: string | null;
  loading: boolean;
  purchasing: boolean;
  purchaseError: string | null;
  clearPurchaseError: () => void;
  packages: CreditPackage[];
  subscriptionTiers: SubscriptionTier[];
  onPurchase: (packageId: CreditPackage["id"]) => Promise<void>;
  onSubscribe: (tierId: SubscriptionTier["id"]) => Promise<void>;
  onManageSubscription: () => Promise<void>;
  /** Called after XRGE payment verifies (refresh credits). */
  onCreditsRefresh?: () => void;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

const CreditDisplay: React.FC<CreditDisplayProps> = ({
  totalCredits,
  dailyCredits,
  subCredits,
  packCredits,
  subscriptionTier,
  subscriptionRenewsAt,
  subscriptionCancelAt,
  loading,
  purchasing,
  purchaseError,
  clearPurchaseError,
  packages,
  subscriptionTiers,
  onPurchase,
  onSubscribe,
  onManageSubscription,
  onCreditsRefresh,
  externalOpen,
  onExternalOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (onExternalOpenChange) onExternalOpenChange(v);
    else setInternalOpen(v);
  };
  const [xrgeOpen, setXrgeOpen] = useState(false);
  const [xrgePackageId, setXrgePackageId] = useState<string | null>(null);
  const [bankOpen, setBankOpen] = useState(false);

  const handleXrgePurchase = (packageId: string) => {
    setXrgePackageId(packageId);
    setXrgeOpen(true);
  };

  const handleXrgeSuccess = () => {
    onCreditsRefresh?.();
  };

  const renewsLabel = subscriptionRenewsAt
    ? new Date(subscriptionRenewsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  const cancelLabel = subscriptionCancelAt
    ? new Date(subscriptionCancelAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  const isCancelling = !!subscriptionTier && !!subscriptionCancelAt;

  return (
    <div className="flex items-center gap-2">
      {/* Credit balance badge */}
      <div
        className="flex items-center gap-1.5 bg-card/60 border border-border/50 rounded px-2 py-1 cursor-default"
        title={`Daily: ${dailyCredits} | Subscription: ${subCredits} | Pack: ${packCredits}`}
      >
        <Coins className="w-3 h-3 text-secondary" />
        <span className="font-mono-share text-xs text-secondary font-bold">
          {loading ? "..." : totalCredits.toLocaleString()}
        </span>
        {subscriptionTier && (
          <span className={`font-orbitron text-[7px] uppercase tracking-wider ml-0.5 ${isCancelling ? "text-destructive/70" : "text-primary/70"}`}>
            {isCancelling ? `${subscriptionTier} (ending)` : subscriptionTier}
          </span>
        )}
      </div>

      {/* Buy / Store button */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="font-mono-share text-xs gap-1.5 text-secondary hover:text-secondary/80"
          >
            <ShoppingCart className="w-3 h-3" />
            <span className="hidden sm:inline">STORE</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-card border-border border-primary/20 shadow-[0_0_48px_hsl(var(--primary)/0.08)] w-[min(96vw,72rem)] max-w-6xl max-h-[85vh] overflow-hidden p-0 gap-0 flex flex-col">
          {/* Inner scroll — must NOT be on DialogContent (grid + overflow quirks; OS scrollbars ignore webkit rules on some builds). */}
          <div className="credit-store-scroll scrollbar-cyber min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 [color-scheme:dark]">
          <DialogHeader>
            <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan">
              CREDIT_STORE
            </DialogTitle>
            <DialogDescription className="font-rajdhani text-muted-foreground">
              10 free credits daily + subscribe or buy packs. Images: 1-2 cr · Videos: 5 cr · HD upscale: 7 cr.
            </DialogDescription>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-pink-500/25 bg-gradient-to-r from-pink-500/10 to-violet-500/10 px-3 py-2.5">
              <img src="/xrge-logo.png" alt="" className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 text-left">
                <p className="font-orbitron text-[10px] tracking-wide text-pink-200">
                  $XRGE Bank — Deposit · Buy Credits · Earn Loyalty Rewards
                </p>
                <p className="font-mono-share text-[9px] text-muted-foreground/90 leading-snug">
                  Deposit XRGE, buy credits from your balance, earn up to +50% bonus.{" "}
                  <a href={XRGE_DEXSCREENER_URL} target="_blank" rel="noopener noreferrer" className="text-pink-300 underline underline-offset-2">
                    Get XRGE →
                  </a>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setOpen(false); setBankOpen(true); }}
                className="shrink-0 font-orbitron text-[9px] tracking-wider gap-1.5 border-pink-500/30 text-pink-300 hover:bg-pink-500/15 hover:text-pink-200"
              >
                <Wallet className="w-3 h-3" />
                BANK
              </Button>
            </div>
          </DialogHeader>

          {/* Current balance summary */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-input/50 border border-border/30 rounded-md px-3 py-2 mt-2">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-secondary" />
              <span className="font-mono-share text-sm text-secondary font-bold">
                {totalCredits}
              </span>
              <span className="font-mono-share text-[10px] text-muted-foreground">total</span>
            </div>
            {subCredits > 0 && (
              <span className="font-mono-share text-[10px] text-muted-foreground/60">
                {subCredits} sub{renewsLabel && ` (resets ${renewsLabel})`}
              </span>
            )}
            {packCredits > 0 && (
              <span className="font-mono-share text-[10px] text-muted-foreground/60">
                {packCredits} pack
              </span>
            )}
          </div>

          {/* Active subscription management — shown prominently before pricing */}
          {subscriptionTier && (
            <div className={`mt-3 border rounded-lg p-3 space-y-2.5 ${
              isCancelling
                ? "border-destructive/40 bg-destructive/5"
                : "border-primary/30 bg-primary/5"
            }`}>
              {isCancelling ? (
                <>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                    <span className="font-orbitron text-xs tracking-wider text-destructive">
                      CANCELLING: {(subscriptionTier ?? "").toUpperCase()}
                    </span>
                    {cancelLabel && (
                      <span className="font-mono-share text-[10px] text-destructive/60 ml-auto">
                        ends {cancelLabel}
                      </span>
                    )}
                  </div>
                  <p className="font-mono-share text-[10px] text-destructive/70 leading-relaxed">
                    Your subscription is scheduled for cancellation. You can still use your remaining {subCredits} sub credits
                    until {cancelLabel || "the end of your billing period"}.
                    Reactivate anytime before then to keep your plan.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onManageSubscription}
                    className="font-mono-share text-xs gap-1.5 border-primary/30 hover:bg-primary/10"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    REACTIVATE_SUBSCRIPTION
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-primary" />
                    <span className="font-orbitron text-xs tracking-wider text-primary">
                      ACTIVE_PLAN: {(subscriptionTier ?? "").toUpperCase()}
                    </span>
                    {renewsLabel && (
                      <span className="font-mono-share text-[10px] text-muted-foreground/60 ml-auto">
                        renews {renewsLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onManageSubscription}
                      className="font-mono-share text-xs gap-1.5 border-primary/30 hover:bg-primary/10"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      MANAGE_BILLING
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onManageSubscription}
                      className="font-mono-share text-xs gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      CANCEL_SUBSCRIPTION
                    </Button>
                  </div>
                  <p className="font-mono-share text-[10px] text-muted-foreground/50 leading-relaxed">
                    Manage billing, update payment method, or cancel your subscription via the Stripe portal.
                    Cancellation takes effect at the end of your current billing period.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Purchase error banner */}
          {purchaseError && (
            <div className="mt-3 flex items-start gap-2 border border-destructive/40 bg-destructive/10 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-mono-share text-xs text-destructive leading-relaxed">{purchaseError}</p>
              </div>
              <button
                onClick={clearPurchaseError}
                className="text-destructive/60 hover:text-destructive transition-colors"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="mt-4">
            <PricingCards
              packages={packages}
              subscriptionTiers={subscriptionTiers}
              currentTier={subscriptionTier}
              purchasing={purchasing}
              onPurchase={async (id) => {
                await onPurchase(id);
              }}
              onSubscribe={async (id) => {
                await onSubscribe(id);
              }}
              onManageSubscription={onManageSubscription}
              onXrgePurchase={handleXrgePurchase}
            />
          </div>

          {/* Referral Section */}
          <ReferralCard />

          <div className="border-t border-border pt-3 mt-2">
            <p className="text-[10px] font-mono-share text-muted-foreground/80 leading-relaxed">
              Payments: Stripe (card) or $XRGE on Base (pack cards). Pack credits never expire. Subscription credits reset each billing cycle (no rollover).
            </p>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* XRGE Payment Dialog */}
      <XrgePaymentDialog
        open={xrgeOpen}
        onClose={() => setXrgeOpen(false)}
        packageId={xrgePackageId}
        onSuccess={handleXrgeSuccess}
      />

      {/* XRGE Bank Dialog */}
      <XrgeBankDialog
        open={bankOpen}
        onOpenChange={setBankOpen}
        onCreditsRefresh={onCreditsRefresh}
      />
    </div>
  );
};

/** Referral card — shows inside the credit store dialog. */
function ReferralCard() {
  const [code, setCode] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchReferral = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/referral", { method: "POST", body: { action: "get-code" } });
      setCode(data.code);
      const statsData = await apiFetch("/referral", { method: "POST", body: { action: "stats" } });
      setStats(statsData);
    } catch {
      // Not logged in or error — silently skip
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReferral(); }, [fetchReferral]);

  const referralLink = code ? `https://grokrunner.gltch.app?ref=${code}` : "";

  const handleCopy = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!code && !loading) return null;

  return (
    <div className="border border-green-500/30 rounded-lg bg-green-950/10 p-3 mt-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Share2 className="w-3.5 h-3.5 text-green-400" />
        <span className="font-orbitron text-[10px] tracking-wider text-green-400">REFERRAL_PROGRAM</span>
      </div>

      <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
        Share your link — friends get <span className="text-green-400">3 free credits</span> on signup.
        When they make their first purchase, you get <span className="text-secondary">10 credits</span> and they get <span className="text-secondary">5 bonus</span>.
      </p>

      {loading ? (
        <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 text-green-400 animate-spin" /></div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-input/50 border border-border/30 rounded px-2.5 py-1.5 font-mono-share text-[10px] text-foreground/80 truncate select-all">
              {referralLink}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="font-mono-share text-[10px] gap-1 px-2 border-green-500/30 hover:bg-green-500/10 shrink-0"
            >
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? "COPIED" : "COPY"}
            </Button>
          </div>

          {stats && (stats.totalReferred > 0 || stats.creditsEarned > 0) && (
            <div className="flex items-center gap-3 pt-1 font-mono-share text-[10px] text-muted-foreground/60">
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" /> {stats.totalReferred} referred
              </span>
              <span className="flex items-center gap-1">
                <Gift className="w-3 h-3" /> {stats.totalPurchased} converted
              </span>
              <span className="flex items-center gap-1 text-green-400">
                +{stats.creditsEarned} credits earned
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CreditDisplay;

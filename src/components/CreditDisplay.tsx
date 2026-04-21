import React, { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Coins, ShoppingCart, Loader2, Crown, Settings, XCircle, AlertTriangle, Share2, Copy, Check, Gift, Users, Wallet, Flame } from "lucide-react";
import { useFlashSale } from "@/hooks/useFlashSale";
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
import SpinWheel from "@/components/SpinWheel";
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
  const { t } = useTranslation();
  const { sale: flashSale, timeLeft: flashTimeLeft, appliesTo: flashApplies } = useFlashSale();
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

  const isControlled = externalOpen !== undefined;

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
            {isCancelling ? `${subscriptionTier} (${t("store.ending")})` : subscriptionTier}
          </span>
        )}
      </div>

      {/* Buy / Store button — always rendered, even when externally controlled,
          so the desktop header always exposes a visible cart entry point. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="font-mono-share text-xs gap-1.5 text-secondary hover:text-secondary/80 relative"
          >
            <ShoppingCart className="w-3 h-3" />
            <span className="hidden sm:inline">{t("nav.store")}</span>
            {flashSale && (
              <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-500/25 border border-orange-400/60 font-orbitron text-[8px] tracking-wider text-orange-200 animate-pulse">
                <Flame className="w-2.5 h-2.5" />
                SALE
              </span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-card border-border border-primary/20 shadow-[0_0_48px_hsl(var(--primary)/0.08)] w-[min(96vw,72rem)] max-w-6xl max-h-[85vh] overflow-hidden p-0 gap-0 flex flex-col">
          {/* Inner scroll — must NOT be on DialogContent (grid + overflow quirks; OS scrollbars ignore webkit rules on some builds). */}
          <div className="credit-store-scroll scrollbar-cyber min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 [color-scheme:dark]">
          <DialogHeader>
            <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan">
              {t("store.title")}
            </DialogTitle>
            <DialogDescription className="font-rajdhani text-muted-foreground">
              {t("store.description")}
            </DialogDescription>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-pink-500/25 bg-gradient-to-r from-pink-500/10 to-violet-500/10 px-3 py-2.5">
              <img src="/xrge-logo.png" alt="" className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 text-left">
                <p className="font-orbitron text-[10px] tracking-wide text-pink-200">
                  {t("store.xrgeBankTitle")}
                </p>
                <p className="font-mono-share text-[9px] text-muted-foreground/90 leading-snug">
                  {t("store.xrgeBankDesc")}{" "}
                  <a href={XRGE_DEXSCREENER_URL} target="_blank" rel="noopener noreferrer" className="text-pink-300 underline underline-offset-2">
                    {t("store.getXrge")}
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
                {t("store.bank")}
              </Button>
            </div>
          </DialogHeader>

          {/* Flash sale banner — prominent, in-store */}
          {flashSale && (
            <div className="mt-3 rounded-lg border-2 border-orange-500/60 bg-gradient-to-r from-orange-600/20 via-pink-500/15 to-orange-600/20 p-3 space-y-1.5 shadow-[0_0_24px_hsl(20_90%_50%/0.25)]">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500/30 ring-2 ring-orange-400/60">
                  <Flame className="h-3.5 w-3.5 text-orange-200 animate-pulse" />
                </div>
                <span className="font-orbitron text-[11px] tracking-widest text-orange-100 font-bold">⚡ FLASH SALE</span>
                <span className="font-mono-share text-[11px] text-orange-100/90">{flashSale.title}</span>
                <span className="ml-auto font-mono-share text-[10px] text-orange-100/80">
                  ends in <span className="font-bold text-yellow-200 tabular-nums">{flashTimeLeft}</span>
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap pl-9">
                {flashSale.discount_percent > 0 && (
                  <span className="font-orbitron text-xs font-bold text-yellow-300">
                    {flashSale.discount_percent}% OFF
                  </span>
                )}
                {flashSale.bonus_credits_percent > 0 && (
                  <span className="font-orbitron text-xs font-bold text-green-300">
                    +{flashSale.bonus_credits_percent}% BONUS CREDITS
                  </span>
                )}
                <span className="font-mono-share text-[9px] text-orange-200/70">
                  {flashSale.packages && flashSale.packages.length > 0
                    ? `Eligible packs: ${flashSale.packages.map(p => p.toUpperCase()).join(", ")}`
                    : "All packs eligible"}
                </span>
              </div>
              <p className="font-mono-share text-[10px] text-orange-100/80 leading-snug pl-9">
                Pay with <span className="text-pink-200 font-bold">XRGE</span> on any eligible pack to apply this sale automatically.
              </p>
            </div>
          )}

          {/* Current balance summary */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-input/50 border border-border/30 rounded-md px-3 py-2 mt-2">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-secondary" />
              <span className="font-mono-share text-sm text-secondary font-bold">
                {totalCredits}
              </span>
              <span className="font-mono-share text-[10px] text-muted-foreground">{t("store.total")}</span>
            </div>
            {subCredits > 0 && (
              <span className="font-mono-share text-[10px] text-muted-foreground/60">
                {subCredits} {t("store.sub")}{renewsLabel && ` (${t("store.resets", { date: renewsLabel })})`}
              </span>
            )}
            {packCredits > 0 && (
              <span className="font-mono-share text-[10px] text-muted-foreground/60">
                {packCredits} {t("store.pack")}
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
                      {t("store.cancellingPlan", { plan: (subscriptionTier ?? "").toUpperCase() })}
                    </span>
                    {cancelLabel && (
                      <span className="font-mono-share text-[10px] text-destructive/60 ml-auto">
                        {t("store.ends", { date: cancelLabel })}
                      </span>
                    )}
                  </div>
                  <p className="font-mono-share text-[10px] text-destructive/70 leading-relaxed">
                    {cancelLabel
                      ? t("store.cancelNotice", { count: subCredits, date: cancelLabel })
                      : t("store.cancelNoticeNoDates")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onManageSubscription}
                    className="font-mono-share text-xs gap-1.5 border-primary/30 hover:bg-primary/10"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    {t("store.reactivate")}
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-primary" />
                    <span className="font-orbitron text-xs tracking-wider text-primary">
                      {t("store.activePlan", { plan: (subscriptionTier ?? "").toUpperCase() })}
                    </span>
                    {renewsLabel && (
                      <span className="font-mono-share text-[10px] text-muted-foreground/60 ml-auto">
                        {t("store.renews", { date: renewsLabel })}
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
                      {t("store.manageBilling")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onManageSubscription}
                      className="font-mono-share text-xs gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {t("store.cancelSubscription")}
                    </Button>
                  </div>
                  <p className="font-mono-share text-[10px] text-muted-foreground/50 leading-relaxed">
                    {t("store.manageDesc")}
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

          {/* Spin Wheel Section */}
          <div className="mt-4 border border-primary/20 rounded-lg bg-primary/5 p-4">
            <h3 className="font-orbitron text-xs tracking-wider neon-text-cyan text-center mb-1">
              🎰 Free Credits
            </h3>
            <p className="font-mono-share text-[10px] text-muted-foreground/60 text-center mb-2">
              Spin the wheel for a chance to win credits! One free spin every 24 hours.
            </p>
            <SpinWheel onCreditsRefresh={onCreditsRefresh} />
          </div>

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
              {t("store.paymentInfo")}
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
  const { t } = useTranslation();
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
        <span className="font-orbitron text-[10px] tracking-wider text-green-400">{t("referral.title")}</span>
      </div>

      <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
        {t("referral.descriptionSimple")}
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
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
          </div>

          {stats && (stats.totalReferred > 0 || stats.creditsEarned > 0) && (
            <div className="flex items-center gap-3 pt-1 font-mono-share text-[10px] text-muted-foreground/60">
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" /> {t("referral.referred", { count: stats.totalReferred })}
              </span>
              <span className="flex items-center gap-1">
                <Gift className="w-3 h-3" /> {t("referral.converted", { count: stats.totalPurchased })}
              </span>
              <span className="flex items-center gap-1 text-green-400">
                {t("referral.earned", { count: stats.creditsEarned })}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CreditDisplay;

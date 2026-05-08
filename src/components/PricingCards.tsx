import React, { useState } from "react";
import { Loader2, Zap, Crown, RefreshCw, Sparkles, ArrowUp, Flame } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SUBSCRIPTION_TIERS_MONTHLY, SUBSCRIPTION_TIERS_YEARLY, TIER_RANK } from "@/lib/api";
import { useFlashSale } from "@/hooks/useFlashSale";
import type { CreditPackage, SubscriptionTier } from "@/lib/api";

interface PricingCardsProps {
  packages: CreditPackage[];
  subscriptionTiers: SubscriptionTier[];
  currentTier: string | null;
  /** Active per-generation discount % (0 if not subscribed). */
  discountPct?: number;
  purchasing: boolean;
  onPurchase: (packageId: string) => Promise<void> | void;
  onSubscribe: (tierId: string) => Promise<void> | void;
  onManageSubscription?: () => Promise<void> | void;
  onXrgePurchase?: (packageId: string) => void;
}

const PricingCards: React.FC<PricingCardsProps> = ({
  packages,
  currentTier,
  discountPct = 0,
  purchasing,
  onPurchase,
  onSubscribe,
  onManageSubscription,
  onXrgePurchase,
}) => {
  const { t } = useTranslation();
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");

  const activeTiers =
    billingInterval === "year" ? SUBSCRIPTION_TIERS_YEARLY : SUBSCRIPTION_TIERS_MONTHLY;

  /** Check if the current sub matches one of these tiers */
  const tierIsActive = (tier: SubscriptionTier) => {
    if (!currentTier) return false;
    const base = tier.id.replace("-yearly", "");
    const currentBase = currentTier.replace("-yearly", "");
    return base === currentBase;
  };

  /** Determine button state for a tier */
  const getTierAction = (tier: SubscriptionTier): "subscribe" | "active" | "upgrade" | "downgrade" => {
    if (!currentTier) return "subscribe";
    if (tierIsActive(tier)) return "active";
    const currentRank = TIER_RANK[currentTier] || 0;
    const tierRank = TIER_RANK[tier.id] || 0;
    return tierRank > currentRank ? "upgrade" : "downgrade";
  };

  return (
    <div className="space-y-6">
      {/* ── Subscription Plans ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="w-3 h-3 text-primary/60" />
          <h4 className="font-orbitron text-[10px] tracking-widest text-muted-foreground">
            {t("pricing.subscriptionPlans")}
          </h4>
          <div className="h-px flex-1 bg-border/30" />
        </div>

        {/* Monthly / Yearly toggle */}
        <div className="flex items-center justify-center gap-1 mb-4">
          <button
            onClick={() => setBillingInterval("month")}
            className={`font-orbitron text-[9px] tracking-wider px-3 py-1.5 rounded-l border transition-all ${
              billingInterval === "month"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card/40 text-muted-foreground border-border hover:bg-primary/10"
            }`}
          >
            {t("pricing.monthly")}
          </button>
          <button
            onClick={() => setBillingInterval("year")}
            className={`font-orbitron text-[9px] tracking-wider px-3 py-1.5 rounded-r border transition-all relative ${
              billingInterval === "year"
                ? "bg-secondary text-secondary-foreground border-secondary"
                : "bg-card/40 text-muted-foreground border-border hover:bg-secondary/10"
            }`}
          >
            {t("pricing.yearly")}
            <span className="absolute -top-2 -right-2 bg-green-500 text-white font-mono text-[7px] px-1.5 py-0.5 rounded-full leading-none">
              -12%
            </span>
          </button>
        </div>

        <div className="grid w-full min-w-0 max-w-full grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-4 gap-3">
          {activeTiers.map((tier) => {
            const isActive = tierIsActive(tier);
            return (
              <div
                key={tier.id}
                className={`relative flex min-w-0 max-w-full flex-col overflow-hidden rounded-lg border-2 transition-all ${
                  tier.popular
                    ? "border-secondary/70 bg-secondary/[0.07] shadow-[0_0_24px_hsl(var(--secondary)/0.12)]"
                    : "border-border/90 bg-card/50"
                } ${isActive ? "ring-2 ring-primary/45 ring-offset-2 ring-offset-background" : ""}`}
              >
                {tier.popular && !isActive && (
                  <div className="border-b border-secondary/50 bg-secondary/85 py-1.5 text-center font-orbitron text-[8px] tracking-[0.18em] text-secondary-foreground">
                    {t("pricing.bestValue")}
                  </div>
                )}
                {isActive && (
                  <div className="border-b border-primary/40 bg-primary/20 py-1.5 text-center font-orbitron text-[8px] tracking-[0.18em] text-primary">
                    {t("pricing.activePlan")}
                  </div>
                )}

                <div className="flex flex-1 flex-col p-3 sm:p-4 min-w-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <Crown className="w-3 h-3 shrink-0 text-primary" />
                  <h3 className="font-orbitron text-xs tracking-wider text-foreground truncate">{tier.name}</h3>
                </div>

                <div className="mb-2 min-w-0 space-y-1">
                  <p className="font-orbitron text-lg font-bold tabular-nums leading-none text-foreground sm:text-xl break-words">
                    ${(tier.priceCents / 100).toFixed(2)}
                  </p>
                  <p className="font-mono-share text-[10px] uppercase tracking-wide text-muted-foreground">
                    {tier.interval === "year" ? t("pricing.perYear") : t("pricing.perMonth")}
                  </p>
                </div>

                {tier.interval === "year" && tier.monthlyEquivalentCents && (
                  <p className="font-mono-share text-[10px] text-green-400 mb-1">
                    ${(tier.monthlyEquivalentCents / 100).toFixed(2)}/mo &mdash; {t("pricing.savePercent", { percent: tier.savingsPercent })}
                  </p>
                )}

                <div className="mb-2 flex items-center gap-1">
                  <Zap className="h-3 w-3 shrink-0 text-secondary" />
                  <span className="font-mono-share text-sm font-bold text-secondary">
                    {tier.discountPercent}% OFF every generation
                  </span>
                </div>

                <p className="mb-1 font-mono-share text-[10px] text-muted-foreground">
                  Permanent discount · No expiry · No math
                </p>
                <p className="mb-1 font-mono-share text-[9px] uppercase tracking-wider text-amber-400/90">
                  ⚠ No monthly credits — discount only
                </p>
                <p className="mb-4 flex-1 font-mono-share text-[9px] leading-snug text-muted-foreground/75">
                  {(() => {
                    const example = 10;
                    const discounted = Math.max(1, Math.ceil(example * (1 - tier.discountPercent / 100)));
                    return `Example: a ${example}-credit edit costs you only ${discounted}. Buy credit packs separately.`;
                  })()}
                </p>

                {(() => {
                  const action = getTierAction(tier);
                  const safeSubscribe = (id: string) => {
                    Promise.resolve(onSubscribe(id)).catch(() => {});
                  };
                  if (action === "active") {
                    return (
                      <Button
                        onClick={() => { Promise.resolve(onManageSubscription?.()).catch(() => {}); }}
                        disabled={purchasing}
                        variant="outline"
                        className="w-full rounded-md font-orbitron text-[10px] tracking-wider gap-1 border-primary/50 text-primary"
                      >
                        {t("pricing.managePlan")}
                      </Button>
                    );
                  }
                  if (action === "downgrade") {
                    return (
                      <Button
                        disabled
                        variant="outline"
                        className="w-full rounded-md font-orbitron text-[10px] tracking-wider gap-1 opacity-40 cursor-not-allowed"
                      >
                        {t("pricing.currentPlanHigher")}
                      </Button>
                    );
                  }
                  if (action === "upgrade") {
                    return (
                      <Button
                        onClick={() => safeSubscribe(tier.id)}
                        disabled={purchasing}
                        className="w-full rounded-md font-orbitron text-[10px] tracking-wider gap-1 bg-green-600 text-white hover:bg-green-500"
                      >
                        {purchasing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <ArrowUp className="w-3 h-3" />
                            {t("pricing.upgrade")}
                          </>
                        )}
                      </Button>
                    );
                  }
                    return (
                      <Button
                        onClick={() => safeSubscribe(tier.id)}
                        disabled={purchasing}
                        className={`w-full rounded-md font-orbitron text-[10px] tracking-wider gap-1 ${
                          tier.popular
                            ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            : "bg-primary text-primary-foreground hover:bg-primary/80"
                        }`}
                      >
                      {purchasing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        t("pricing.subscribe")
                      )}
                    </Button>
                  );
                })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── One-Time Credit Packs ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-3 h-3 text-primary/60" />
          <h4 className="font-orbitron text-[10px] tracking-widest text-muted-foreground">
            {t("pricing.topUpPacks")}
          </h4>
          <div className="h-px flex-1 bg-border/30" />
        </div>

        {/* Standard packs (3 cols) */}
        <div className="grid w-full min-w-0 max-w-full grid-cols-1 sm:grid-cols-3 gap-3">
          {packages.slice(0, 3).map((pkg) => (
            <PackCard key={pkg.id} pkg={pkg} purchasing={purchasing} onPurchase={onPurchase} onXrgePurchase={onXrgePurchase} discountPct={discountPct} />
          ))}
        </div>

        {/* Big packs (2 cols) */}
        {packages.length > 3 && (
          <>
            <div className="flex items-center gap-2 my-3">
              <Sparkles className="w-3 h-3 text-secondary/60" />
              <h4 className="font-orbitron text-[10px] tracking-widest text-muted-foreground/60">
                {t("pricing.bulkPacks")}
              </h4>
              <div className="h-px flex-1 bg-border/20" />
            </div>
            <div className="grid w-full min-w-0 max-w-full grid-cols-1 sm:grid-cols-2 gap-3">
              {packages.slice(3).map((pkg) => (
                <PackCard key={pkg.id} pkg={pkg} purchasing={purchasing} onPurchase={onPurchase} onXrgePurchase={onXrgePurchase} discountPct={discountPct} isBulk />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** Reusable pack card */
function PackCard({
  pkg,
  purchasing,
  onPurchase,
  onXrgePurchase,
  isBulk,
  discountPct = 0,
}: {
  pkg: CreditPackage;
  purchasing: boolean;
  onPurchase: (id: string) => Promise<void> | void;
  onXrgePurchase?: (id: string) => void;
  isBulk?: boolean;
  discountPct?: number;
}) {
  const { t } = useTranslation();
  const { sale: flashSale, appliesTo: flashApplies } = useFlashSale();
  const onFlash = !!flashSale && flashApplies(pkg.id);

  // Subscriber bonus: matches webhook formula. Effectively makes the in-app
  // pack price scale with the user's subscription discount.
  const bonusCredits =
    discountPct > 0 ? Math.floor((pkg.credits * discountPct) / (100 - discountPct)) : 0;
  const totalCredits = pkg.credits + bonusCredits;

  return (
    <div
      className={`relative flex min-w-0 max-w-full flex-col overflow-hidden rounded-lg border-2 transition-all ${
        onFlash
          ? "border-orange-500/70 bg-gradient-to-b from-orange-500/[0.08] to-card/50 shadow-[0_0_20px_hsl(20_90%_50%/0.18)]"
          : pkg.popular
          ? "border-secondary/70 bg-secondary/[0.06] shadow-[0_0_20px_hsl(var(--secondary)/0.1)]"
          : isBulk
          ? "border-primary/45 bg-primary/[0.06] shadow-[0_0_16px_hsl(var(--primary)/0.08)]"
          : "border-border/90 bg-card/50"
      }`}
    >
      {onFlash && (
        <div className="border-b border-orange-500/60 bg-gradient-to-r from-orange-600/40 via-pink-500/40 to-orange-600/40 py-1.5 px-2 flex items-center justify-center gap-1.5 font-orbitron text-[8px] tracking-[0.18em] text-orange-100">
          <Flame className="w-3 h-3 animate-pulse" />
          FLASH SALE
          {flashSale!.discount_percent > 0 && <span className="text-yellow-200">{flashSale!.discount_percent}% OFF</span>}
          {flashSale!.bonus_credits_percent > 0 && <span className="text-green-200">+{flashSale!.bonus_credits_percent}% BONUS</span>}
        </div>
      )}
      {pkg.popular && !onFlash && (
        <div className="border-b border-secondary/50 bg-secondary/85 py-1.5 text-center font-orbitron text-[8px] tracking-[0.18em] text-secondary-foreground">
          {t("pricing.popular")}
        </div>
      )}
      {isBulk && !pkg.popular && !onFlash && (
        <div className="border-b border-primary/40 bg-primary/20 py-1.5 text-center font-orbitron text-[8px] tracking-[0.18em] text-primary">
          {t("pricing.bulk")}
        </div>
      )}

      <div className="flex flex-1 flex-col p-3 sm:p-4 min-w-0">
      <h3 className="mb-2 font-orbitron text-xs tracking-wider text-foreground truncate">{pkg.name}</h3>

      <div className="mb-2 min-w-0 space-y-1">
        <p className="font-orbitron text-xl font-bold tabular-nums leading-none text-foreground sm:text-2xl break-words">
          ${(pkg.priceCents / 100).toFixed(2)}
        </p>
        <p className="font-mono-share text-[10px] uppercase tracking-wide text-muted-foreground">{t("pricing.oneTime")}</p>
      </div>

      <div className="mb-1 flex items-center gap-1">
        <Zap className="h-3 w-3 shrink-0 text-secondary" />
        <span className="font-mono-share text-sm font-bold text-secondary">
          {totalCredits.toLocaleString()} credits
        </span>
        {bonusCredits > 0 && (
          <span className="font-mono-share text-[8px] text-green-400 bg-green-400/10 px-1 py-0.5 rounded">
            +{bonusCredits} sub bonus
          </span>
        )}
      </div>

      <p className="mb-1 flex-1 font-mono-share text-[10px] text-muted-foreground">
        {pkg.perCredit}/credit &mdash; never expires
      </p>

      <div className="space-y-2">
        <Button
          onClick={() => { Promise.resolve(onPurchase(pkg.id)).catch(() => {}); }}
          disabled={purchasing}
          className={`w-full rounded-md font-orbitron text-[10px] tracking-wider gap-1 ${
            pkg.popular
              ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              : isBulk
              ? "bg-primary text-primary-foreground hover:bg-primary/80"
              : "bg-primary text-primary-foreground hover:bg-primary/80"
          }`}
        >
          {purchasing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            t("pricing.purchase")
          )}
        </Button>
        {onXrgePurchase && (
          <>
            <div className="flex items-center gap-2 my-1">
              <div className="h-px flex-1 bg-border/30" />
              <span className="font-mono-share text-[8px] text-pink-400/70 tracking-widest">{t("pricing.orCrypto")}</span>
              <div className="h-px flex-1 bg-border/30" />
            </div>
            <button
              type="button"
              onClick={() => onXrgePurchase(pkg.id)}
              disabled={purchasing}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-md border border-[#c44b8b]/50 bg-gradient-to-r from-[#8b2fc0]/10 via-[#c44b8b]/10 to-[#e8445a]/10 hover:from-[#8b2fc0]/20 hover:via-[#c44b8b]/20 hover:to-[#e8445a]/20 hover:border-[#c44b8b]/70 transition-all disabled:opacity-50"
            >
              <img src="/xrge-logo.png" alt="" className="w-5 h-5 rounded-full" />
              <span className="font-orbitron text-[10px] tracking-wider text-white/90">{t("pricing.payWithXrge")}</span>
              <span className="text-green-400 font-mono-share text-[8px] font-bold bg-green-400/10 px-1.5 py-0.5 rounded-full leading-none">{t("pricing.bonusPercent", { percent: 30 })}</span>
            </button>
            <p className="font-mono-share text-[8px] text-center text-muted-foreground/55 leading-tight">
              {t("pricing.baseChain")}
            </p>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

export default PricingCards;

import React, { useState } from "react";
import { Loader2, Zap, Crown, RefreshCw, Sparkles, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PayPalButtons } from "@paypal/react-paypal-js";
import { apiFetch, SUBSCRIPTION_TIERS_MONTHLY, SUBSCRIPTION_TIERS_YEARLY, TIER_RANK } from "@/lib/api";
import type { CreditPackage, SubscriptionTier } from "@/lib/api";

interface PricingCardsProps {
  packages: CreditPackage[];
  subscriptionTiers: SubscriptionTier[];
  currentTier: string | null;
  purchasing: boolean;
  onPurchase: (packageId: string) => void;
  onSubscribe: (tierId: string) => void;
  onManageSubscription?: () => void;
  onPayPalSuccess?: () => void;
  onXrgePurchase?: (packageId: string) => void;
}

const PricingCards: React.FC<PricingCardsProps> = ({
  packages,
  currentTier,
  purchasing,
  onPurchase,
  onSubscribe,
  onManageSubscription,
  onPayPalSuccess,
  onXrgePurchase,
}) => {
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
            SUBSCRIPTION_PLANS
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
            MONTHLY
          </button>
          <button
            onClick={() => setBillingInterval("year")}
            className={`font-orbitron text-[9px] tracking-wider px-3 py-1.5 rounded-r border transition-all relative ${
              billingInterval === "year"
                ? "bg-secondary text-secondary-foreground border-secondary"
                : "bg-card/40 text-muted-foreground border-border hover:bg-secondary/10"
            }`}
          >
            YEARLY
            <span className="absolute -top-2 -right-2 bg-green-500 text-white font-mono text-[7px] px-1.5 py-0.5 rounded-full leading-none">
              -12%
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {activeTiers.map((tier) => {
            const isActive = tierIsActive(tier);
            return (
              <div
                key={tier.id}
                className={`relative flex flex-col border rounded-lg p-4 transition-all ${
                  tier.popular
                    ? "border-secondary/60 bg-secondary/5 shadow-[0_0_12px_rgba(var(--secondary-rgb),0.15)]"
                    : "border-border bg-card/40"
                } ${isActive ? "ring-1 ring-primary/50" : ""}`}
              >
                {tier.popular && !isActive && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-secondary text-secondary-foreground font-orbitron text-[8px] tracking-widest px-3 py-0.5 rounded-full">
                    BEST VALUE
                  </div>
                )}
                {isActive && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground font-orbitron text-[8px] tracking-widest px-3 py-0.5 rounded-full">
                    ACTIVE
                  </div>
                )}

                <div className="flex items-center gap-1.5 mb-1">
                  <Crown className="w-3 h-3 text-secondary" />
                  <h3 className="font-orbitron text-xs tracking-wider text-foreground">{tier.name}</h3>
                </div>

                <div className="flex items-baseline gap-1 mb-1">
                  <span className="font-orbitron text-2xl font-bold text-foreground">
                    ${(tier.priceCents / 100).toFixed(2)}
                  </span>
                  <span className="font-mono-share text-[10px] text-muted-foreground">
                    /{tier.interval === "year" ? "year" : "month"}
                  </span>
                </div>

                {tier.interval === "year" && tier.monthlyEquivalentCents && (
                  <p className="font-mono-share text-[10px] text-green-400 mb-1">
                    ${(tier.monthlyEquivalentCents / 100).toFixed(2)}/mo &mdash; save {tier.savingsPercent}%
                  </p>
                )}

                <div className="flex items-center gap-1 mb-2">
                  <Zap className="w-3 h-3 text-secondary" />
                  <span className="font-mono-share text-sm text-secondary font-bold">
                    {tier.creditsPerMonth} credits/mo
                  </span>
                </div>

                <p className="font-mono-share text-[10px] text-muted-foreground mb-1">
                  {tier.perCredit}/credit
                </p>
                <p className="font-mono-share text-[9px] text-muted-foreground/50 mb-4 flex-1">
                  Credits reset each billing cycle
                </p>

                {(() => {
                  const action = getTierAction(tier);
                  if (action === "active") {
                    return (
                      <Button
                        onClick={onManageSubscription}
                        disabled={purchasing}
                        variant="outline"
                        className="w-full font-orbitron text-[10px] tracking-wider gap-1 border-primary/50 text-primary"
                      >
                        MANAGE_PLAN
                      </Button>
                    );
                  }
                  if (action === "downgrade") {
                    return (
                      <Button
                        disabled
                        variant="outline"
                        className="w-full font-orbitron text-[10px] tracking-wider gap-1 opacity-40 cursor-not-allowed"
                      >
                        CURRENT_PLAN_HIGHER
                      </Button>
                    );
                  }
                  if (action === "upgrade") {
                    return (
                      <Button
                        onClick={() => onSubscribe(tier.id)}
                        disabled={purchasing}
                        className="w-full font-orbitron text-[10px] tracking-wider gap-1 bg-green-600 text-white hover:bg-green-500"
                      >
                        {purchasing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <ArrowUp className="w-3 h-3" />
                            UPGRADE
                          </>
                        )}
                      </Button>
                    );
                  }
                  return (
                    <Button
                      onClick={() => onSubscribe(tier.id)}
                      disabled={purchasing}
                      className={`w-full font-orbitron text-[10px] tracking-wider gap-1 ${
                        tier.popular
                          ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                          : "bg-primary text-primary-foreground hover:bg-primary/80"
                      }`}
                    >
                      {purchasing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "SUBSCRIBE"
                      )}
                    </Button>
                  );
                })()}
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
            TOP_UP_PACKS
          </h4>
          <div className="h-px flex-1 bg-border/30" />
        </div>

        {/* Standard packs (3 cols) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {packages.slice(0, 3).map((pkg) => (
            <PackCard key={pkg.id} pkg={pkg} purchasing={purchasing} onPurchase={onPurchase} onPayPalSuccess={onPayPalSuccess} onXrgePurchase={onXrgePurchase} />
          ))}
        </div>

        {/* Big packs (2 cols) */}
        {packages.length > 3 && (
          <>
            <div className="flex items-center gap-2 my-3">
              <Sparkles className="w-3 h-3 text-secondary/60" />
              <h4 className="font-orbitron text-[10px] tracking-widest text-muted-foreground/60">
                BULK_PACKS
              </h4>
              <div className="h-px flex-1 bg-border/20" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {packages.slice(3).map((pkg) => (
                <PackCard key={pkg.id} pkg={pkg} purchasing={purchasing} onPurchase={onPurchase} onPayPalSuccess={onPayPalSuccess} onXrgePurchase={onXrgePurchase} isBulk />
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
  onPayPalSuccess,
  onXrgePurchase,
  isBulk,
}: {
  pkg: CreditPackage;
  purchasing: boolean;
  onPurchase: (id: string) => void;
  onPayPalSuccess?: () => void;
  onXrgePurchase?: (id: string) => void;
  isBulk?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col border rounded-lg p-4 transition-all ${
        pkg.popular
          ? "border-secondary/60 bg-secondary/5 shadow-[0_0_12px_rgba(var(--secondary-rgb),0.15)]"
          : isBulk
          ? "border-primary/40 bg-primary/5 shadow-[0_0_8px_rgba(var(--primary-rgb),0.1)]"
          : "border-border bg-card/40"
      }`}
    >
      {pkg.popular && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-secondary text-secondary-foreground font-orbitron text-[8px] tracking-widest px-3 py-0.5 rounded-full">
          POPULAR
        </div>
      )}
      {isBulk && !pkg.popular && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground font-orbitron text-[8px] tracking-widest px-3 py-0.5 rounded-full">
          BULK
        </div>
      )}

      <h3 className="font-orbitron text-xs tracking-wider text-foreground mb-1">{pkg.name}</h3>

      <div className="flex items-baseline gap-1 mb-2">
        <span className="font-orbitron text-2xl font-bold text-foreground">
          ${(pkg.priceCents / 100).toFixed(0)}
        </span>
        <span className="font-mono-share text-[10px] text-muted-foreground">one-time</span>
      </div>

      <div className="flex items-center gap-1 mb-3">
        <Zap className="w-3 h-3 text-secondary" />
        <span className="font-mono-share text-sm text-secondary font-bold">
          {pkg.credits.toLocaleString()} credits
        </span>
      </div>

      <p className="font-mono-share text-[10px] text-muted-foreground mb-1 flex-1">
        {pkg.perCredit}/credit &mdash; never expires
      </p>

      <div className="space-y-2">
        <Button
          onClick={() => onPurchase(pkg.id)}
          disabled={purchasing}
          className={`w-full font-orbitron text-[10px] tracking-wider gap-1 ${
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
            "PURCHASE"
          )}
        </Button>
        {onPayPalSuccess && (
          <div className="flex items-center gap-2 my-1">
            <div className="h-px flex-1 bg-border/30" />
            <span className="font-mono-share text-[8px] text-muted-foreground/40 tracking-widest">OR_PAY_WITH</span>
            <div className="h-px flex-1 bg-border/30" />
          </div>
        )}
        {onPayPalSuccess && (
          <div className="flex justify-center">
            <div className="w-full max-w-[200px] min-h-[40px] [&>div]:min-h-[40px] rounded border border-border/40 bg-black/20 p-1.5 shadow-[0_0_6px_rgba(var(--primary-rgb),0.1)]">
              <PayPalButtons
                style={{ layout: "horizontal", color: "black", shape: "rect", label: "paypal", height: 35, tagline: false }}
                createOrder={async () => {
                  const { orderId } = (await apiFetch("/paypal", {
                    method: "POST",
                    body: { action: "create", package: pkg.id },
                  })) as { orderId: string };
                  return orderId;
                }}
                onApprove={async (data) => {
                  await apiFetch("/paypal", {
                    method: "POST",
                    body: { action: "capture", orderID: data.orderID },
                  });
                  onPayPalSuccess();
                }}
              />
            </div>
          </div>
        )}
        {onXrgePurchase && (
          <>
            <div className="flex items-center gap-2 my-1.5">
              <div className="h-px flex-1 bg-border/30" />
              <span className="font-mono-share text-[8px] text-muted-foreground/40 tracking-widest">OR</span>
              <div className="h-px flex-1 bg-border/30" />
            </div>
            <button
              onClick={() => onXrgePurchase(pkg.id)}
              disabled={purchasing}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-md border border-[#c44b8b]/50 bg-gradient-to-r from-[#8b2fc0]/10 via-[#c44b8b]/10 to-[#e8445a]/10 hover:from-[#8b2fc0]/20 hover:via-[#c44b8b]/20 hover:to-[#e8445a]/20 hover:border-[#c44b8b]/70 transition-all disabled:opacity-50"
            >
              <img src="/xrge-logo.png" alt="XRGE" className="w-5 h-5 rounded-full" />
              <span className="font-orbitron text-[10px] tracking-wider text-white/90">PAY WITH $XRGE</span>
              <span className="text-green-400 font-mono-share text-[8px] font-bold bg-green-400/10 px-1.5 py-0.5 rounded-full leading-none">+15%</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default PricingCards;

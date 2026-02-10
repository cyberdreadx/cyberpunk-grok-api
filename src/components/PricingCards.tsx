import React from "react";
import { Loader2, Zap, Crown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreditPackage, SubscriptionTier } from "@/lib/api";

interface PricingCardsProps {
  packages: CreditPackage[];
  subscriptionTiers: SubscriptionTier[];
  currentTier: string | null;
  purchasing: boolean;
  onPurchase: (packageId: CreditPackage["id"]) => void;
  onSubscribe: (tierId: SubscriptionTier["id"]) => void;
  onManageSubscription?: () => void;
}

const PricingCards: React.FC<PricingCardsProps> = ({
  packages,
  subscriptionTiers,
  currentTier,
  purchasing,
  onPurchase,
  onSubscribe,
  onManageSubscription,
}) => {
  return (
    <div className="space-y-6">
      {/* ── Monthly Subscriptions ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="w-3 h-3 text-primary/60" />
          <h4 className="font-orbitron text-[10px] tracking-widest text-muted-foreground">
            MONTHLY_PLANS
          </h4>
          <div className="h-px flex-1 bg-border/30" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {subscriptionTiers.map((tier) => {
            const isActive = currentTier === tier.id;
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

                <div className="flex items-baseline gap-1 mb-2">
                  <span className="font-orbitron text-2xl font-bold text-foreground">
                    ${(tier.priceCents / 100).toFixed(2)}
                  </span>
                  <span className="font-mono-share text-[10px] text-muted-foreground">/month</span>
                </div>

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

                {isActive ? (
                  <Button
                    onClick={onManageSubscription}
                    disabled={purchasing}
                    variant="outline"
                    className="w-full font-orbitron text-[10px] tracking-wider gap-1 border-primary/50 text-primary"
                  >
                    MANAGE_PLAN
                  </Button>
                ) : (
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
                )}
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className={`relative flex flex-col border rounded-lg p-4 transition-all ${
                pkg.popular
                  ? "border-secondary/60 bg-secondary/5 shadow-[0_0_12px_rgba(var(--secondary-rgb),0.15)]"
                  : "border-border bg-card/40"
              }`}
            >
              {pkg.popular && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-secondary text-secondary-foreground font-orbitron text-[8px] tracking-widest px-3 py-0.5 rounded-full">
                  POPULAR
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
                  {pkg.credits} credits
                </span>
              </div>

              <p className="font-mono-share text-[10px] text-muted-foreground mb-1 flex-1">
                {pkg.perCredit}/credit — never expires
              </p>

              <Button
                onClick={() => onPurchase(pkg.id)}
                disabled={purchasing}
                className={`w-full font-orbitron text-[10px] tracking-wider gap-1 ${
                  pkg.popular
                    ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    : "bg-primary text-primary-foreground hover:bg-primary/80"
                }`}
              >
                {purchasing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  "PURCHASE"
                )}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PricingCards;

import React, { useState } from "react";
import { Coins, ShoppingCart, Loader2, Crown, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import PricingCards from "@/components/PricingCards";
import type { CreditPackage, SubscriptionTier } from "@/lib/api";

interface CreditDisplayProps {
  totalCredits: number;
  subCredits: number;
  packCredits: number;
  subscriptionTier: string | null;
  subscriptionRenewsAt: string | null;
  loading: boolean;
  purchasing: boolean;
  packages: CreditPackage[];
  subscriptionTiers: SubscriptionTier[];
  onPurchase: (packageId: CreditPackage["id"]) => Promise<void>;
  onSubscribe: (tierId: SubscriptionTier["id"]) => Promise<void>;
  onManageSubscription: () => Promise<void>;
}

const CreditDisplay: React.FC<CreditDisplayProps> = ({
  totalCredits,
  subCredits,
  packCredits,
  subscriptionTier,
  subscriptionRenewsAt,
  loading,
  purchasing,
  packages,
  subscriptionTiers,
  onPurchase,
  onSubscribe,
  onManageSubscription,
}) => {
  const [open, setOpen] = useState(false);

  const renewsLabel = subscriptionRenewsAt
    ? new Date(subscriptionRenewsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <div className="flex items-center gap-2">
      {/* Credit balance badge */}
      <div
        className="flex items-center gap-1.5 bg-card/60 border border-border/50 rounded px-2 py-1 cursor-default"
        title={`Subscription: ${subCredits} | Pack: ${packCredits}`}
      >
        <Coins className="w-3 h-3 text-secondary" />
        <span className="font-mono-share text-xs text-secondary font-bold">
          {loading ? "..." : totalCredits.toLocaleString()}
        </span>
        {subscriptionTier && (
          <span className="font-orbitron text-[7px] text-primary/70 uppercase tracking-wider ml-0.5">
            {subscriptionTier}
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
        <DialogContent className="bg-card border-border sm:max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan">
              CREDIT_STORE
            </DialogTitle>
            <DialogDescription className="font-rajdhani text-muted-foreground">
              Subscribe monthly or buy one-time packs. 1 credit = 1 image or 1 second of video.
            </DialogDescription>
          </DialogHeader>

          {/* Current balance summary */}
          <div className="flex items-center gap-4 bg-input/50 border border-border/30 rounded px-3 py-2 mt-2">
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
            />
          </div>

          <div className="border-t border-border pt-3 mt-2 space-y-1">
            <p className="text-[10px] font-mono-share text-muted-foreground/60 leading-relaxed">
              Payments processed securely via Stripe. Pack credits never expire. Subscription credits reset each billing cycle (no rollover).
            </p>
            {subscriptionTier && (
              <button
                onClick={onManageSubscription}
                className="flex items-center gap-1 text-[10px] font-mono-share text-primary/60 hover:text-primary transition-colors"
              >
                <Settings className="w-3 h-3" />
                Manage subscription / billing
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreditDisplay;

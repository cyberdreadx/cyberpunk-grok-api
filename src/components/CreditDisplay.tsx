import React, { useState } from "react";
import { Coins, ShoppingCart, Loader2, Crown, Settings, XCircle } from "lucide-react";
import { PayPalScriptProvider } from "@paypal/react-paypal-js";
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
  onPayPalSuccess?: () => void;
}

const paypalClientId = import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined;

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
  onPayPalSuccess,
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

          {/* Active subscription management — shown prominently before pricing */}
          {subscriptionTier && (
            <div className="mt-3 border border-primary/30 rounded-lg bg-primary/5 p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-primary" />
                <span className="font-orbitron text-xs tracking-wider text-primary">
                  ACTIVE_PLAN: {subscriptionTier.toUpperCase()}
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
            </div>
          )}

          <div className="mt-4">
            {paypalClientId ? (
              <PayPalScriptProvider
                options={{
                  clientId: paypalClientId,
                  currency: "USD",
                  intent: "capture",
                  disableFunding: "paylater,credit,card",
                }}
              >
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
                  onPayPalSuccess={onPayPalSuccess}
                />
              </PayPalScriptProvider>
            ) : (
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
            )}
          </div>

          <div className="border-t border-border pt-3 mt-2">
            <p className="text-[10px] font-mono-share text-muted-foreground/60 leading-relaxed">
              Payments processed securely via Stripe{paypalClientId ? " and PayPal" : ""}. Pack credits never expire. Subscription credits reset each billing cycle (no rollover).
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreditDisplay;

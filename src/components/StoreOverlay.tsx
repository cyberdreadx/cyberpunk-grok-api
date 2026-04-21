/**
 * StoreOverlay — controlled wrapper around CreditDisplay that exposes
 * just the store dialog (no inline balance/trigger button). Used by
 * pages that want the mobile bottom-nav STORE tap to open the store
 * inline without navigating away.
 */
import React from "react";
import CreditDisplay from "@/components/CreditDisplay";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";

interface StoreOverlayProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const StoreOverlay: React.FC<StoreOverlayProps> = ({ open, onOpenChange }) => {
  const { user } = useAuth();
  const credits = useCredits(user);

  if (!user) return null;

  return (
    <div className="hidden-store-host" aria-hidden={!open}>
      <style>{`.hidden-store-host > div > .flex.items-center.gap-2 > *:not([role="dialog"]):not([data-state]) { display: none !important; }`}</style>
      <CreditDisplay
        totalCredits={credits.totalCredits}
        dailyCredits={credits.dailyCredits}
        subCredits={credits.subCredits}
        packCredits={credits.packCredits}
        subscriptionTier={credits.subscriptionTier}
        subscriptionRenewsAt={credits.subscriptionRenewsAt}
        subscriptionCancelAt={credits.subscriptionCancelAt}
        loading={credits.loading}
        purchasing={credits.purchasing}
        purchaseError={credits.purchaseError}
        clearPurchaseError={credits.clearPurchaseError}
        packages={credits.packages}
        subscriptionTiers={credits.subscriptionTiers}
        onPurchase={credits.purchaseCredits}
        onSubscribe={credits.subscribeToPlan}
        onManageSubscription={credits.manageSubscription}
        onCreditsRefresh={credits.refreshCredits}
        externalOpen={open}
        onExternalOpenChange={onOpenChange}
      />
    </div>
  );
};

export default StoreOverlay;

/**
 * Credits hook — fetches split balance from /api/credits,
 * triggers checkout via /api/checkout.
 * No Supabase dependency. No realtime — uses polling after actions.
 */

import { useState, useEffect, useCallback } from "react";
import {
  apiFetch,
  backendEnabled,
  CREDIT_PACKAGES,
  SUBSCRIPTION_TIERS,
  type CreditPackage,
  type SubscriptionTier,
} from "@/lib/api";
import type { AuthUser } from "@/hooks/useAuth";

export function useCredits(user: AuthUser | null) {
  const [dailyCredits, setDailyCredits] = useState<number>(0);
  const [subCredits, setSubCredits] = useState<number>(0);
  const [packCredits, setPackCredits] = useState<number>(0);
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null);
  const [subscriptionRenewsAt, setSubscriptionRenewsAt] = useState<string | null>(null);
  const [subscriptionCancelAt, setSubscriptionCancelAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const totalCredits = dailyCredits + subCredits + packCredits;

  // Fetch credit balance
  const fetchCredits = useCallback(async () => {
    if (!user) {
      setDailyCredits(0);
      setSubCredits(0);
      setPackCredits(0);
      setSubscriptionTier(null);
      setSubscriptionRenewsAt(null);
      setSubscriptionCancelAt(null);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch("/credits");
      setDailyCredits(data.daily_credits ?? 0);
      setSubCredits(data.sub_credits ?? 0);
      setPackCredits(data.pack_credits ?? 0);
      setSubscriptionTier(data.subscription_tier ?? null);
      setSubscriptionRenewsAt(data.subscription_renews_at ?? null);
      setSubscriptionCancelAt(data.subscription_cancel_at ?? null);
    } catch (err: any) {
      console.warn("[useCredits] Error fetching:", err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // Purchase one-time credit pack
  const purchaseCredits = useCallback(async (packageId: CreditPackage["id"]) => {
    if (!user) throw new Error("Not authenticated");
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const data = await apiFetch("/checkout", {
        method: "POST",
        body: { package: packageId },
      });
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      const msg = err.message || "Purchase failed. Please try again.";
      setPurchaseError(msg);
      throw err;
    } finally {
      setPurchasing(false);
    }
  }, [user]);

  // Subscribe to monthly plan
  const subscribeToPlan = useCallback(async (tierId: SubscriptionTier["id"]) => {
    if (!user) throw new Error("Not authenticated");
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const data = await apiFetch("/checkout", {
        method: "POST",
        body: { subscription: tierId },
      });
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      const msg = err.message || "Subscription failed. Please try again.";
      setPurchaseError(msg);
      throw err;
    } finally {
      setPurchasing(false);
    }
  }, [user]);

  // Open Stripe Customer Portal
  const manageSubscription = useCallback(async () => {
    if (!user) throw new Error("Not authenticated");
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const data = await apiFetch("/checkout", {
        method: "POST",
        body: { action: "portal" },
      });
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (err: any) {
      const msg = err.message || "Failed to open billing portal. Please try again.";
      setPurchaseError(msg);
      throw err;
    } finally {
      setPurchasing(false);
    }
  }, [user]);

  // Optimistic local deduction (mirrors server logic: daily → sub → pack)
  const deductCreditsLocally = useCallback((amount: number) => {
    setDailyCredits((prevDaily) => {
      let remaining = amount;
      const fromDaily = Math.min(prevDaily, remaining);
      remaining -= fromDaily;
      if (remaining > 0) {
        setSubCredits((prevSub) => {
          const fromSub = Math.min(prevSub, remaining);
          remaining -= fromSub;
          if (remaining > 0) {
            setPackCredits((prevPack) => Math.max(0, prevPack - remaining));
          }
          return prevSub - fromSub;
        });
      }
      return prevDaily - fromDaily;
    });
  }, []);

  return {
    totalCredits,
    subCredits,
    packCredits,
    subscriptionTier,
    subscriptionRenewsAt,
    subscriptionCancelAt,
    hasSubscription: !!subscriptionTier,
    isCancelling: !!subscriptionTier && !!subscriptionCancelAt,
    loading,
    purchasing,
    purchaseError,
    clearPurchaseError: () => setPurchaseError(null),
    packages: CREDIT_PACKAGES,
    subscriptionTiers: SUBSCRIPTION_TIERS,
    enabled: backendEnabled && !!user,
    hasEnoughCredits: (cost: number) => totalCredits >= cost,
    purchaseCredits,
    subscribeToPlan,
    manageSubscription,
    deductCreditsLocally,
    refreshCredits: fetchCredits,
  };
}

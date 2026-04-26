/**
 * Credits hook — fetches split balance from /api/credits,
 * triggers checkout via /api/checkout.
 * No Supabase dependency. No realtime — uses polling after actions.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
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
  const [loraUnlocked, setLoraUnlocked] = useState(false);
  const [freeCreditsDisabled, setFreeCreditsDisabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
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
      setLoraUnlocked(false);
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
      setLoraUnlocked(data.lora_unlocked ?? false);
      setFreeCreditsDisabled(!!data.free_credits_disabled);
      setMaintenanceMessage(data.maintenance_message ?? null);
    } catch (err: any) {
      console.warn("[useCredits] Error fetching:", err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // Auto-refresh: poll while tab is visible, refetch on focus/visibility,
  // and listen for cross-component "credits-changed" broadcasts so balances
  // stay in sync without manual page refreshes.
  useEffect(() => {
    if (!user) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === "visible") fetchCredits();
      }, 30000);
    };
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchCredits();
        startPolling();
      } else {
        stopPolling();
      }
    };
    const onFocus = () => fetchCredits();
    const onCreditsChanged = () => fetchCredits();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "credits-changed") fetchCredits();
    };

    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("credits-changed", onCreditsChanged);
    window.addEventListener("storage", onStorage);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("credits-changed", onCreditsChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [user, fetchCredits]);

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

  // Purchase LoRA unlock ($30 one-time)
  const purchaseLoraUnlock = useCallback(async () => {
    if (!user) throw new Error("Not authenticated");
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const data = await apiFetch("/checkout", {
        method: "POST",
        body: { action: "lora_unlock" },
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

  const clearPurchaseError = useCallback(() => setPurchaseError(null), []);
  const hasEnoughCredits = useCallback((cost: number) => totalCredits >= cost, [totalCredits]);

  return useMemo(() => ({
    totalCredits,
    dailyCredits,
    subCredits,
    packCredits,
    subscriptionTier,
    subscriptionRenewsAt,
    subscriptionCancelAt,
    loraUnlocked,
    freeCreditsDisabled,
    maintenanceMessage,
    hasSubscription: !!subscriptionTier,
    isCancelling: !!subscriptionTier && !!subscriptionCancelAt,
    loading,
    purchasing,
    purchaseError,
    clearPurchaseError,
    packages: CREDIT_PACKAGES,
    subscriptionTiers: SUBSCRIPTION_TIERS,
    enabled: backendEnabled && !!user,
    hasEnoughCredits,
    purchaseCredits,
    purchaseLoraUnlock,
    subscribeToPlan,
    manageSubscription,
    deductCreditsLocally,
    refreshCredits: fetchCredits,
  }), [
    totalCredits, dailyCredits, subCredits, packCredits,
    subscriptionTier, subscriptionRenewsAt, subscriptionCancelAt,
    loraUnlocked, freeCreditsDisabled, maintenanceMessage,
    loading, purchasing, purchaseError,
    clearPurchaseError, hasEnoughCredits,
    user, purchaseCredits, purchaseLoraUnlock, subscribeToPlan,
    manageSubscription, deductCreditsLocally, fetchCredits,
  ]);
}

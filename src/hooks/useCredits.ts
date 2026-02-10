/**
 * Credits hook: reads split balance (sub_credits + pack_credits) from Supabase,
 * triggers Stripe checkout for one-time packs or subscriptions,
 * and opens the Stripe Customer Portal for subscription management.
 */

import { useState, useEffect, useCallback } from "react";
import {
  supabase,
  supabaseEnabled,
  CREDIT_PACKAGES,
  SUBSCRIPTION_TIERS,
  type CreditPackage,
  type SubscriptionTier,
} from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export function useCredits(user: User | null) {
  const [subCredits, setSubCredits] = useState<number>(0);
  const [packCredits, setPackCredits] = useState<number>(0);
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null);
  const [subscriptionRenewsAt, setSubscriptionRenewsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const totalCredits = subCredits + packCredits;

  // ── Fetch credit balance & subscription info ──
  const fetchCredits = useCallback(async () => {
    if (!supabase || !user) {
      setSubCredits(0);
      setPackCredits(0);
      setSubscriptionTier(null);
      setSubscriptionRenewsAt(null);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("sub_credits, pack_credits, subscription_tier, subscription_renews_at")
        .eq("id", user.id)
        .single();
      if (error) {
        // Profile might not exist yet — create it
        if (error.code === "PGRST116") {
          const { data: newProfile } = await supabase
            .from("profiles")
            .insert({ id: user.id, sub_credits: 0, pack_credits: 0 })
            .select("sub_credits, pack_credits, subscription_tier, subscription_renews_at")
            .single();
          setSubCredits(newProfile?.sub_credits ?? 0);
          setPackCredits(newProfile?.pack_credits ?? 0);
          setSubscriptionTier(newProfile?.subscription_tier ?? null);
          setSubscriptionRenewsAt(newProfile?.subscription_renews_at ?? null);
        } else {
          console.warn("[useCredits] Error fetching credits:", error.message);
        }
      } else {
        setSubCredits(data?.sub_credits ?? 0);
        setPackCredits(data?.pack_credits ?? 0);
        setSubscriptionTier(data?.subscription_tier ?? null);
        setSubscriptionRenewsAt(data?.subscription_renews_at ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // ── Listen for real-time credit changes ──
  useEffect(() => {
    if (!supabase || !user) return;
    const channel = supabase
      .channel("credits-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (typeof row?.sub_credits === "number") setSubCredits(row.sub_credits);
          if (typeof row?.pack_credits === "number") setPackCredits(row.pack_credits);
          if (row?.subscription_tier !== undefined) setSubscriptionTier(row.subscription_tier);
          if (row?.subscription_renews_at !== undefined) setSubscriptionRenewsAt(row.subscription_renews_at);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // ── Purchase one-time credit pack via Stripe Checkout ──
  const purchaseCredits = useCallback(async (packageId: CreditPackage["id"]) => {
    if (!supabase || !user) throw new Error("Not authenticated");
    setPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-checkout", {
        body: { package: packageId },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } finally {
      setPurchasing(false);
    }
  }, [user]);

  // ── Subscribe to a monthly plan via Stripe Checkout ──
  const subscribeToPlan = useCallback(async (tierId: SubscriptionTier["id"]) => {
    if (!supabase || !user) throw new Error("Not authenticated");
    setPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-checkout", {
        body: { subscription: tierId },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } finally {
      setPurchasing(false);
    }
  }, [user]);

  // ── Open Stripe Customer Portal for subscription management ──
  const manageSubscription = useCallback(async () => {
    if (!supabase || !user) throw new Error("Not authenticated");
    setPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-checkout", {
        body: { action: "portal" },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No portal URL returned");
      }
    } finally {
      setPurchasing(false);
    }
  }, [user]);

  // ── Deduct credits locally (optimistic, real deduction on server) ──
  const deductCreditsLocally = useCallback((amount: number) => {
    // Mirror the server logic: deduct from sub first, then pack
    setSubCredits((prevSub) => {
      const fromSub = Math.min(prevSub, amount);
      const remainder = amount - fromSub;
      if (remainder > 0) {
        setPackCredits((prevPack) => Math.max(0, prevPack - remainder));
      }
      return prevSub - fromSub;
    });
  }, []);

  return {
    // Balances
    totalCredits,
    subCredits,
    packCredits,
    // Subscription
    subscriptionTier,
    subscriptionRenewsAt,
    hasSubscription: !!subscriptionTier,
    // State
    loading,
    purchasing,
    // Config
    packages: CREDIT_PACKAGES,
    subscriptionTiers: SUBSCRIPTION_TIERS,
    enabled: supabaseEnabled && !!user,
    // Helpers
    hasEnoughCredits: (cost: number) => totalCredits >= cost,
    // Actions
    purchaseCredits,
    subscribeToPlan,
    manageSubscription,
    deductCreditsLocally,
    refreshCredits: fetchCredits,
  };
}

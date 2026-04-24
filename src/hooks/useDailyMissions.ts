import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { AuthUser } from "@/hooks/useAuth";

export interface MissionStatus {
  streakDay: number;
  cycleStart: string;
  lastClaimDate: string | null;
  streakBonusClaimed: boolean;
  totalEarned: number;
  claimedToday: string[];
  missions: string[];
  missionCredits: Record<string, number>;
  streakBonus: number;
  cycleDays: number;
  /** Most recent public feed post by this user — used to prefill share intents. */
  lastFeedPost?: { id: string; image_url: string | null; text: string | null } | null;
}

export function useDailyMissions(user: AuthUser | null) {
  const [status, setStatus] = useState<MissionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!user) { setStatus(null); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/daily-missions");
      setStatus(data);
    } catch (err: any) {
      console.warn("[useDailyMissions]", err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const claimMission = useCallback(async (mission: string, url?: string) => {
    setClaiming(true);
    try {
      await apiFetch("/daily-missions", { method: "POST", body: { mission, url } });
      await fetchStatus();
      return true;
    } catch (err: any) {
      const msg = err.message || "Failed to claim";
      if (msg.includes("not completed")) {
        toast.error("Complete the mission first, then claim your reward!");
      } else if (msg.includes("Already claimed") || msg.includes("Already submitted")) {
        toast.info("Already claimed today");
      } else {
        toast.error(msg);
      }
      console.warn("[claimMission]", msg);
      return false;
    } finally {
      setClaiming(false);
    }
  }, [fetchStatus]);

  const claimStreakBonus = useCallback(async () => {
    setClaiming(true);
    try {
      await apiFetch("/daily-missions", { method: "POST", body: { mission: "streak_bonus" } });
      await fetchStatus();
      return true;
    } catch {
      return false;
    } finally {
      setClaiming(false);
    }
  }, [fetchStatus]);

  return { status, loading, claiming, claimMission, claimStreakBonus, refreshMissions: fetchStatus };
}

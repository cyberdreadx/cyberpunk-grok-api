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

  const claimMission = useCallback(async (mission: string) => {
    setClaiming(true);
    try {
      await apiFetch("/daily-missions", { method: "POST", body: { mission } });
      await fetchStatus();
      return true;
    } catch (err: any) {
      console.warn("[claimMission]", err.message);
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

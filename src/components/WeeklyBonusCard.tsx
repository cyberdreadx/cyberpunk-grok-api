import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Gift, Clock } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { AuthUser } from "@/hooks/useAuth";

interface WeeklyStatus {
  reward: number;
  claimable: boolean;
  lastClaimedAt: string | null;
  nextAvailableAt: string | null;
}

interface Props {
  user: AuthUser | null;
  onCreditsRefresh?: () => void;
}

function formatRemaining(target: string): string {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return "ready";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export default function WeeklyBonusCard({ user, onCreditsRefresh }: Props) {
  const [status, setStatus] = useState<WeeklyStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!user) { setStatus(null); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/weekly-bonus");
      setStatus(data);
    } catch (e: any) {
      console.warn("[WeeklyBonusCard]", e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (!user || loading || !status) return null;

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await apiFetch("/weekly-bonus", { method: "POST" });
      toast.success(`+${status.reward} ⚡ weekly bonus claimed!`);
      onCreditsRefresh?.();
      await fetchStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to claim");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-gradient-to-r from-primary/10 to-secondary/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-primary text-sm font-bold">
        <Gift className="w-4 h-4" />
        Weekly Bonus: +{status.reward} ⚡
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Free credits every 7 days. Available to everyone.
      </p>
      <Button
        size="sm"
        onClick={handleClaim}
        disabled={claiming || !status.claimable}
        className="w-full h-8 text-[11px] bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-50"
      >
        {claiming ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : status.claimable ? (
          <Gift className="w-3 h-3 mr-1" />
        ) : (
          <Clock className="w-3 h-3 mr-1" />
        )}
        {status.claimable
          ? `Claim +${status.reward} ⚡`
          : `Available in ${status.nextAvailableAt ? formatRemaining(status.nextAvailableAt) : "7d"}`}
      </Button>
    </div>
  );
}

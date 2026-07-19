import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, Trophy, Check } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { AuthUser } from "@/hooks/useAuth";

interface Milestone {
  threshold: number;
  credits: number;
  reached: boolean;
  claimed: boolean;
}

interface EarnStatus {
  qualifiedKarma: number;
  qualifiedKarma7d: number;
  eligible: boolean;
  eligibilityReason: "verify_email" | "account_too_new" | null;
  milestones: Milestone[];
  weekly: { week: string; available: number; claimed: boolean; divisor: number; cap: number };
}

interface Props {
  user: AuthUser | null;
  onCreditsRefresh?: () => void;
}

export default function EarnCreditsCard({ user, onCreditsRefresh }: Props) {
  const [status, setStatus] = useState<EarnStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!user) { setStatus(null); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/earn");
      setStatus(data);
    } catch (e: any) {
      console.warn("[EarnCreditsCard]", e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (!user || loading || !status) return null;

  const claim = async (body: Record<string, unknown>, key: string, amount: number) => {
    setClaiming(key);
    try {
      await apiFetch("/earn", { method: "POST", body });
      toast.success(`+${amount} ⚡ earned!`);
      onCreditsRefresh?.();
      await fetchStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to claim");
    } finally {
      setClaiming(null);
    }
  };

  const nextMilestone = status.milestones.find((m) => !m.claimed);
  const claimableMilestones = status.milestones.filter((m) => m.reached && !m.claimed);
  const weeklyClaimable = status.eligible && !status.weekly.claimed && status.weekly.available >= 1;

  return (
    <div className="rounded-lg border border-primary/40 bg-gradient-to-r from-primary/10 to-secondary/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-primary text-sm font-bold">
        <Zap className="w-4 h-4" />
        Earn Credits
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Post content, get real engagement. Likes, upvotes &amp; comments you{" "}
        <span className="text-primary">receive</span> become credits — {status.qualifiedKarma} engagement karma so far.
      </p>

      {status.eligibilityReason === "verify_email" && (
        <p className="text-[10px] text-yellow-400">Verify your email to start earning.</p>
      )}
      {status.eligibilityReason === "account_too_new" && (
        <p className="text-[10px] text-yellow-400">Earning unlocks 3 days after signup.</p>
      )}

      {/* Weekly engagement payout */}
      <Button
        size="sm"
        onClick={() => claim({ action: "claim_weekly" }, "weekly", status.weekly.available)}
        disabled={!weeklyClaimable || claiming !== null}
        className="w-full h-8 text-[11px] bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-50"
      >
        {claiming === "weekly" ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : status.weekly.claimed ? (
          <Check className="w-3 h-3 mr-1" />
        ) : (
          <Zap className="w-3 h-3 mr-1" />
        )}
        {status.weekly.claimed
          ? "Weekly payout claimed"
          : status.weekly.available >= 1
            ? `Claim weekly +${status.weekly.available} ⚡`
            : `Weekly payout: get engagement first (${status.qualifiedKarma7d}/${status.weekly.divisor} karma)`}
      </Button>

      {/* Karma milestones */}
      {claimableMilestones.map((m) => (
        <Button
          key={m.threshold}
          size="sm"
          onClick={() => claim({ action: "claim_milestone", threshold: m.threshold }, `ms_${m.threshold}`, m.credits)}
          disabled={!status.eligible || claiming !== null}
          className="w-full h-8 text-[11px] bg-secondary/20 border border-secondary/40 text-secondary-foreground hover:bg-secondary/30 disabled:opacity-50"
        >
          {claiming === `ms_${m.threshold}` ? (
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
          ) : (
            <Trophy className="w-3 h-3 mr-1" />
          )}
          {m.threshold} karma milestone: claim +{m.credits} ⚡
        </Button>
      ))}
      {claimableMilestones.length === 0 && nextMilestone && (
        <p className="text-[10px] text-muted-foreground">
          <Trophy className="w-3 h-3 inline mr-1" />
          Next milestone: {nextMilestone.threshold} karma → +{nextMilestone.credits} ⚡
          ({status.qualifiedKarma}/{nextMilestone.threshold})
        </p>
      )}
    </div>
  );
}

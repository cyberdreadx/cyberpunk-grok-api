import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Twitter, Loader2, CheckCircle2, ExternalLink, Gift } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { AuthUser } from "@/hooks/useAuth";

interface FollowBonusStatus {
  claimKey: string;
  accounts: string[];
  reward: number;
  claimed: boolean;
  claimedAt: string | null;
}

interface Props {
  user: AuthUser | null;
  onCreditsRefresh?: () => void;
}

export default function FollowBonusCard({ user, onCreditsRefresh }: Props) {
  const [status, setStatus] = useState<FollowBonusStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  const fetchStatus = useCallback(async () => {
    if (!user) { setStatus(null); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/follow-bonus");
      setStatus(data);
    } catch (e: any) {
      console.warn("[FollowBonusCard]", e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (!user || loading || !status || status.claimed) return null;

  const allOpened = status.accounts.every((a) => opened[a]);

  const handleOpen = (handle: string) => {
    setOpened((s) => ({ ...s, [handle]: true }));
    window.open(`https://x.com/${handle}`, "_blank", "noopener,noreferrer");
  };

  const handleClaim = async () => {
    if (!allOpened) {
      toast.info("Open both follow links first");
      return;
    }
    setClaiming(true);
    try {
      await apiFetch("/follow-bonus", { method: "POST" });
      toast.success(`+${status.reward} ⚡ for following on X!`);
      onCreditsRefresh?.();
      await fetchStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to claim");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="rounded-lg border border-secondary/40 bg-gradient-to-r from-secondary/10 to-primary/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-secondary text-sm font-bold">
        <Gift className="w-4 h-4" />
        One-Time Bonus: +{status.reward} ⚡
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Follow both accounts on X, then claim. One-time only.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {status.accounts.map((handle) => (
          <Button
            key={handle}
            size="sm"
            variant="outline"
            onClick={() => handleOpen(handle)}
            className={`h-8 text-[11px] gap-1 ${
              opened[handle]
                ? "border-primary/40 text-primary bg-primary/10"
                : "border-muted-foreground/20"
            }`}
          >
            {opened[handle] ? <CheckCircle2 className="w-3 h-3" /> : <Twitter className="w-3 h-3" />}
            @{handle}
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </Button>
        ))}
      </div>
      <Button
        size="sm"
        onClick={handleClaim}
        disabled={claiming || !allOpened}
        className="w-full h-8 text-[11px] bg-secondary/20 border border-secondary/40 text-secondary hover:bg-secondary/30 disabled:opacity-40"
      >
        {claiming ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <Gift className="w-3 h-3 mr-1" />
        )}
        {allOpened ? `Claim +${status.reward} ⚡` : "Open both links to unlock"}
      </Button>
    </div>
  );
}

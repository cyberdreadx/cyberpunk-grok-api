import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Gift, Star, CheckCircle2, Circle, Trophy, Flame, Share2, Image, MessageCircle, Loader2 } from "lucide-react";
import type { MissionStatus } from "@/hooks/useDailyMissions";

interface Props {
  status: MissionStatus | null;
  loading: boolean;
  claiming: boolean;
  onClaim: (mission: string) => Promise<boolean>;
  onClaimStreak: () => Promise<boolean>;
  onCreditsRefresh?: () => void;
}

const MISSION_META: Record<string, { label: string; desc: string; icon: React.ReactNode }> = {
  login:    { label: "Daily Check-in",  desc: "Open the app and claim",         icon: <CalendarCheck className="w-4 h-4" /> },
  generate: { label: "Generate",        desc: "Create at least 1 generation",   icon: <Image className="w-4 h-4" /> },
  story:    { label: "Post a Story",    desc: "Share a creation to Stories",     icon: <MessageCircle className="w-4 h-4" /> },
  reddit:   { label: "Share on Reddit", desc: "Post to r/GrokRunner",           icon: <Share2 className="w-4 h-4" /> },
  share:    { label: "Share Creation",  desc: "Share any result with a link",   icon: <Share2 className="w-4 h-4" /> },
};

export default function DailyMissionsDialog({ status, loading, claiming, onClaim, onClaimStreak, onCreditsRefresh }: Props) {
  const [open, setOpen] = useState(false);

  if (!status && !loading) return null;

  const streakDay = status?.streakDay ?? 1;
  const cycleDays = status?.cycleDays ?? 7;
  const claimedToday = status?.claimedToday ?? [];
  const missionCredits = status?.missionCredits ?? {};
  const streakBonus = status?.streakBonus ?? 50;
  const streakBonusClaimed = status?.streakBonusClaimed ?? false;
  const missions = status?.missions ?? [];
  const totalEarned = status?.totalEarned ?? 0;

  const todayComplete = missions.length > 0 && claimedToday.length >= missions.length;
  const canClaimStreakBonus = streakDay >= cycleDays && !streakBonusClaimed;

  const handleClaim = async (mission: string) => {
    const ok = await onClaim(mission);
    if (ok) onCreditsRefresh?.();
  };

  const handleStreakClaim = async () => {
    const ok = await onClaimStreak();
    if (ok) onCreditsRefresh?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary font-mono-share text-xs relative"
        >
          <CalendarCheck className="w-3.5 h-3.5" />
          Daily Missions
          {!todayComplete && missions.length > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-secondary rounded-full animate-pulse" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-card border-primary/20 font-mono-share">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-orbitron text-primary text-lg">
            <Trophy className="w-5 h-5 text-secondary" />
            Daily Missions
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Streak tracker */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-orange-400" />
                  Day {streakDay} of {cycleDays}
                </span>
                <span>Total earned: {totalEarned} ⚡</span>
              </div>

              {/* Day progress dots */}
              <div className="flex items-center gap-1.5 justify-center">
                {Array.from({ length: cycleDays }).map((_, i) => {
                  const dayNum = i + 1;
                  const isCompleted = dayNum < streakDay;
                  const isCurrent = dayNum === streakDay;
                  const isBonus = dayNum === cycleDays;
                  return (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${
                          isCompleted
                            ? "bg-primary/20 border-primary text-primary"
                            : isCurrent
                            ? "bg-secondary/20 border-secondary text-secondary animate-pulse"
                            : "bg-muted/30 border-muted-foreground/20 text-muted-foreground/40"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : isBonus ? (
                          <Gift className="w-4 h-4" />
                        ) : (
                          dayNum
                        )}
                      </div>
                      <span className="text-[8px] text-muted-foreground/50">
                        {isBonus ? "BONUS" : `D${dayNum}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Streak bonus */}
            {canClaimStreakBonus && (
              <div className="bg-gradient-to-r from-secondary/10 to-accent/10 border border-secondary/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-secondary text-sm font-bold">
                  <Star className="w-4 h-4" />
                  7-Day Streak Complete!
                </div>
                <p className="text-xs text-muted-foreground">
                  Claim your {streakBonus} bonus credits for completing the full week!
                </p>
                <Button
                  size="sm"
                  onClick={handleStreakClaim}
                  disabled={claiming}
                  className="w-full bg-secondary/20 border border-secondary/40 text-secondary hover:bg-secondary/30 text-xs"
                >
                  {claiming ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Gift className="w-3 h-3 mr-1" />}
                  Claim {streakBonus} ⚡ Bonus
                </Button>
              </div>
            )}

            {/* Mission list */}
            <div className="space-y-2">
              <h3 className="text-xs text-muted-foreground uppercase tracking-wider">Today's Missions</h3>
              {missions.map((m) => {
                const meta = MISSION_META[m] || { label: m, desc: "", icon: <Circle className="w-4 h-4" /> };
                const claimed = claimedToday.includes(m);
                const reward = missionCredits[m] || 5;
                return (
                  <div
                    key={m}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      claimed
                        ? "bg-primary/5 border-primary/20 opacity-60"
                        : "bg-muted/20 border-muted-foreground/10 hover:border-primary/30"
                    }`}
                  >
                    <div className={`shrink-0 ${claimed ? "text-primary" : "text-muted-foreground"}`}>
                      {claimed ? <CheckCircle2 className="w-5 h-5" /> : meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{meta.label}</div>
                      <div className="text-[10px] text-muted-foreground">{meta.desc}</div>
                    </div>
                    <div className="shrink-0">
                      {claimed ? (
                        <span className="text-[10px] text-primary font-bold">✓ DONE</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleClaim(m)}
                          disabled={claiming}
                          className="text-[10px] h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                        >
                          {claiming ? <Loader2 className="w-3 h-3 animate-spin" /> : `+${reward} ⚡`}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer info */}
            <p className="text-[9px] text-muted-foreground/40 text-center">
              Missions reset daily at midnight UTC. Complete all 7 days for a {streakBonus} ⚡ streak bonus. Missing a day resets your streak.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

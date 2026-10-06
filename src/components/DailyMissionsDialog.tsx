import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarCheck, Gift, Star, CheckCircle2, Circle, Trophy, Flame, Share2, MessageCircle, Loader2, ExternalLink, X } from "lucide-react";
import type { MissionStatus } from "@/hooks/useDailyMissions";
import EarnCreditsCard from "@/components/EarnCreditsCard";
import type { AuthUser } from "@/hooks/useAuth";

interface Props {
  status: MissionStatus | null;
  loading: boolean;
  claiming: boolean;
  onClaim: (mission: string, url?: string) => Promise<boolean>;
  onClaimStreak: () => Promise<boolean>;
  onCreditsRefresh?: () => void;
  user?: AuthUser | null;
}

// Reddit missions retired 2026-09-29 — unverifiable, see api/daily-missions.ts
type ProofPlatform = "twitter";

const MISSION_META: Record<string, { label: string; desc: string; icon: React.ReactNode; needsUrl?: ProofPlatform }> = {
  login:           { label: "Daily Check-in",   desc: "Open the app and claim",                 icon: <CalendarCheck className="w-4 h-4" /> },
  story:           { label: "Post a Story",      desc: "Share a creation to Stories",            icon: <MessageCircle className="w-4 h-4" /> },
  twitter:         { label: "Share on X",        desc: "Post on X & paste your link",            icon: <Share2 className="w-4 h-4" /> , needsUrl: "twitter" },
  share:           { label: "Share Creation",    desc: "Share any result with a link",           icon: <Share2 className="w-4 h-4" /> },
};

/**
 * Build a Reddit/X submit URL pre-filled with the user's most recent public
 * feed post (image + caption) when available, otherwise fall back to a
 * generic landing-page link. Authentic posts convert dramatically better
 * than bare promo links.
 */
function buildShareIntent(
  platform: ProofPlatform,
  lastFeedPost: MissionStatus["lastFeedPost"]
): { url: string; label: string; usingPrefill: boolean } {
  const APP_URL = "https://grokrunner.gltch.app";
  const mediaUrl = lastFeedPost?.image_url || null;
  const caption = (lastFeedPost?.text || "").trim();
  const usingPrefill = !!mediaUrl;

  if (platform === "twitter") {
    const text = usingPrefill
      ? `${caption || "Made this with GLTCH Runner"} — ${APP_URL}`
      : `Check out what I made with @GLTCHRunner — free AI image & video generation ${APP_URL}`;
    // X intent supports `text` + `url`; if we have media we still link to gltch (X doesn't accept remote img upload via intent)
    return { url: `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, label: "Open X", usingPrefill };
  }

  /*
   * Reddit used to be handled here. Those missions were retired on 2026-09-29
   * because no Reddit post could be verified from the server, so the reward was
   * paid for a link nobody read. Sharing to Reddit still works from the app's
   * own share sheet — it just isn't a paid mission any more.
   */
  const title = usingPrefill
    ? (caption.slice(0, 280) || "Made with GLTCH Runner")
    : "Check out what I made with GLTCH Runner";
  const params = new URLSearchParams({ title, url: mediaUrl || APP_URL });
  return {
    url: `https://www.reddit.com/r/grokrunner/submit?${params.toString()}`,
    label: "Open Reddit",
    usingPrefill,
  };
}

export default function DailyMissionsDialog({ status, loading, claiming, onClaim, onClaimStreak, onCreditsRefresh, user }: Props) {
  const [open, setOpen] = useState(false);
  const [activeProof, setActiveProof] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState("");

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

  const handleClaim = async (mission: string, url?: string) => {
    const ok = await onClaim(mission, url);
    if (ok) {
      onCreditsRefresh?.();
      setActiveProof(null);
      setProofUrl("");
    }
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
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-secondary rounded-full" />
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
            {/* Engagement-based free credits (replaced weekly/follow bonuses) */}
            <EarnCreditsCard user={user ?? null} onCreditsRefresh={onCreditsRefresh} />

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
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-tiny font-bold border-2 transition-all ${
                          isCompleted
                            ? "bg-primary/20 border-primary text-primary"
                            : isCurrent
                            ?"bg-secondary/20 border-secondary text-secondary"
                            : "bg-muted/30 border-muted-foreground/20 text-muted-foreground/60"
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
                      <span className="text-micro text-muted-foreground/70">
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
                const meta = MISSION_META[m] || { label: m, desc: "", icon: <Circle className="w-4 h-4" />, needsUrl: undefined as ProofPlatform | undefined };
                const claimed = claimedToday.includes(m);
                const reward = missionCredits[m] || 5;
                const isOpenProof = activeProof === m;
                const intent = meta.needsUrl ? buildShareIntent(meta.needsUrl, status?.lastFeedPost) : null;
                return (
                  <div
                    key={m}
                    className={`rounded-lg border transition-all ${
                      claimed
                        ? "bg-primary/5 border-primary/20 opacity-60"
                        : isOpenProof
                        ? "bg-muted/30 border-primary/40"
                        : "bg-muted/20 border-muted-foreground/10 hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-3 p-3">
                      <div className={`shrink-0 ${claimed ? "text-primary" : "text-muted-foreground"}`}>
                        {claimed ? <CheckCircle2 className="w-5 h-5" /> : meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{meta.label}</div>
                        <div className="text-tiny text-muted-foreground">{meta.desc}</div>
                      </div>
                      <div className="shrink-0">
                        {claimed ? (
                          <span className="text-tiny text-primary font-bold">✓ Done</span>
                        ) : meta.needsUrl ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActiveProof(isOpenProof ? null : m);
                              setProofUrl("");
                            }}
                            disabled={claiming}
                            className="text-tiny h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                          >
                            {isOpenProof ? <X className="w-3 h-3" /> : `+${reward} ⚡`}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleClaim(m)}
                            disabled={claiming}
                            className="text-tiny h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                          >
                            {claiming ? <Loader2 className="w-3 h-3 animate-spin" /> : `+${reward} ⚡`}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* URL proof flow — X only; the Reddit missions were retired */}
                    {isOpenProof && intent && !claimed && (
                      <div className="px-3 pb-3 space-y-2 border-t border-muted-foreground/10 pt-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-tiny text-muted-foreground leading-snug flex-1">
                            1. Post about GLTCH Runner, with a link to it. 2. Copy your post URL.
                            3. Paste it below — we check the post actually links to us.
                          </p>
                          <a
                            href={intent.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 inline-flex items-center gap-1 text-tiny text-secondary hover:text-secondary/80 underline"
                          >
                            {intent.label}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {intent.usingPrefill && (
                          <p className="text-tiny text-primary/70 leading-snug">
                            ✨ Pre-filled with your latest feed post — most authentic posts get the most upvotes.
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Input
                            value={proofUrl}
                            onChange={(e) => setProofUrl(e.target.value)}
                            placeholder={
                              meta.needsUrl === "twitter"
                                ? "https://x.com/you/status/..."
                                : "https://x.com/you/status/..."
                            }
                            className="h-8 text-xs bg-background/50 border-muted-foreground/20"
                            disabled={claiming}
                          />
                          <Button
                            size="sm"
                            onClick={() => handleClaim(m, proofUrl)}
                            disabled={claiming || !proofUrl.trim()}
                            className="h-8 text-tiny bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 shrink-0"
                          >
                            {claiming ? <Loader2 className="w-3 h-3 animate-spin" /> : "Claim"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer info */}
            <p className="text-tiny text-muted-foreground/60 text-center">
              Missions reset daily at midnight UTC. Complete all 7 days for a {streakBonus} ⚡ streak bonus. Missing a day resets your streak.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

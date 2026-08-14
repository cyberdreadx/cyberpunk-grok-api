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

type ProofPlatform = "reddit" | "grok_subreddit" | "twitter";

const MISSION_META: Record<string, { label: string; desc: string; icon: React.ReactNode; needsUrl?: ProofPlatform }> = {
  login:           { label: "Daily Check-in",   desc: "Open the app and claim",                 icon: <CalendarCheck className="w-4 h-4" /> },
  story:           { label: "Post a Story",      desc: "Share a creation to Stories",            icon: <MessageCircle className="w-4 h-4" /> },
  reddit:          { label: "Share on Reddit",   desc: "Post to any subreddit & paste link",     icon: <Share2 className="w-4 h-4" />, needsUrl: "reddit" },
  grok_subreddit:  { label: "Post in r/grok",    desc: "Post to r/grok (highest-converting!)",   icon: <Share2 className="w-4 h-4 text-orange-400" />, needsUrl: "grok_subreddit" },
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

  // Reddit: r/grok for the premium mission, the platform's r/grokrunner otherwise
  const subreddit = platform === "grok_subreddit" ? "grok" : "grokrunner";
  const title = usingPrefill
    ? (caption.slice(0, 280) || "Made with GLTCH Runner")
    : "Check out what I made with GLTCH Runner";
  const linkUrl = mediaUrl || APP_URL;
  // `url=` makes it a link/image post (qualifies for r/grok mission's media requirement)
  const params = new URLSearchParams({ title, url: linkUrl });
  return {
    url: `https://www.reddit.com/r/${subreddit}/submit?${params.toString()}`,
    label: platform === "grok_subreddit" ? "Open r/grok" : "Open Reddit",
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
                        <div className="text-[10px] text-muted-foreground">{meta.desc}</div>
                      </div>
                      <div className="shrink-0">
                        {claimed ? (
                          <span className="text-[10px] text-primary font-bold">✓ DONE</span>
                        ) : meta.needsUrl ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActiveProof(isOpenProof ? null : m);
                              setProofUrl("");
                            }}
                            disabled={claiming}
                            className="text-[10px] h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                          >
                            {isOpenProof ? <X className="w-3 h-3" /> : `+${reward} ⚡`}
                          </Button>
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

                    {/* URL proof flow for reddit / r/grok / twitter */}
                    {isOpenProof && intent && !claimed && (
                      <div className="px-3 pb-3 space-y-2 border-t border-muted-foreground/10 pt-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-muted-foreground leading-snug flex-1">
                            {meta.needsUrl === "grok_subreddit" ? (
                              <>
                                1. Post in r/grok (link or image — no text-only).{" "}
                                2. Wait ~10 min so Reddit indexes it.{" "}
                                3. Paste your post URL below.
                              </>
                            ) : (
                              <>1. Post about GLTCH Runner. 2. Copy your post URL. 3. Paste it below.</>
                            )}
                          </p>
                          <a
                            href={intent.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 inline-flex items-center gap-1 text-[10px] text-secondary hover:text-secondary/80 underline"
                          >
                            {intent.label}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {meta.needsUrl === "grok_subreddit" && (
                          <div className="rounded-md border border-orange-400/30 bg-orange-400/5 p-2 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-bold text-orange-300 uppercase tracking-wider">
                                💡 Find complaint threads
                              </span>
                              <a
                                href={`https://www.reddit.com/r/grok/search/?q=${encodeURIComponent('limit OR broken OR censored OR "rate limit" OR refused OR "won\'t generate"')}&restrict_sr=1&sort=new`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 inline-flex items-center gap-1 text-[10px] text-orange-300 hover:text-orange-200 underline"
                              >
                                Search r/grok
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                            <p className="text-[9px] text-muted-foreground/80 leading-snug">
                              Reply with something like: <span className="text-orange-200/90">"Try GLTCH Runner — uncensored image + video gen, free to join: grokrunner.gltch.app"</span>. Paste your <strong>comment permalink</strong> above to claim.
                            </p>
                          </div>
                        )}
                        {intent.usingPrefill && (
                          <p className="text-[9px] text-primary/70 leading-snug">
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
                                : meta.needsUrl === "grok_subreddit"
                                  ? "https://reddit.com/r/grok/comments/..."
                                  : "https://reddit.com/r/.../comments/..."
                            }
                            className="h-8 text-[11px] bg-background/50 border-muted-foreground/20"
                            disabled={claiming}
                          />
                          <Button
                            size="sm"
                            onClick={() => handleClaim(m, proofUrl)}
                            disabled={claiming || !proofUrl.trim()}
                            className="h-8 text-[10px] bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 shrink-0"
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
            <p className="text-[9px] text-muted-foreground/40 text-center">
              Missions reset daily at midnight UTC. Complete all 7 days for a {streakBonus} ⚡ streak bonus. Missing a day resets your streak.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

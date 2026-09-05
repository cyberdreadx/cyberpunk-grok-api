import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Diamond, Flame, ExternalLink, Wallet, Sparkles, ShieldCheck, Zap, Clock } from "lucide-react";
import { HOLDER_TIERS, STREAK_BONUSES, type HolderTierInfo } from "@/lib/holderTiers";
import { XRGE_DEXSCREENER_URL } from "@/lib/xrgePublic";
import HolderBadge, { type HolderTierId } from "@/components/HolderBadge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: open the XRGE Bank dialog when the user clicks "Open XRGE Bank". */
  onOpenBank?: () => void;
}

/**
 * Holder Program explainer — describes tiers, perks, the streak multiplier,
 * and the 3 steps to start. Surfaces from BuyHoldBanner, HolderProgramPromo,
 * and any other entrypoint that wants a deep explanation.
 */
const HolderProgramDialog: React.FC<Props> = ({ open, onOpenChange, onOpenBank }) => {
  const tiers: HolderTierInfo[] = HOLDER_TIERS.filter(t => t.id !== "none").slice().reverse();
  const streaks = STREAK_BONUSES.slice().reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-violet-500/30 shadow-glow-ambient w-[min(96vw,42rem)] max-w-2xl max-h-[88vh] overflow-hidden p-0 gap-0 flex flex-col">
        <div className="scrollbar-cyber min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 [color-scheme:dark]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md border border-violet-400/40 bg-violet-500/15 text-violet-300 shadow-glow-live">
                <Diamond className="h-4 w-4" strokeWidth={2.5} />
              </div>
              <DialogTitle className="font-orbitron text-sm tracking-widest text-violet-200 uppercase">
                Holder Program
              </DialogTitle>
            </div>
            <DialogDescription className="font-mono-share text-[11px] text-muted-foreground/90 leading-relaxed pt-1">
              Hold <span className="text-violet-200 font-bold">XRGE</span> to unlock permanent generation discounts, daily credit bonuses, locked LoRAs, and access to GLTCH PRO. Perks scale with how much you hold and how long you've held.
            </DialogDescription>
          </DialogHeader>

          {/* How it works */}
          <section className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              { icon: <Wallet className="w-3.5 h-3.5" />, title: "Bind wallet", body: "Link any Base wallet holding XRGE. Custodial bank balance counts too." },
              { icon: <ShieldCheck className="w-3.5 h-3.5" />, title: "Daily snapshot", body: "We snapshot your on-chain + bank balance every 24h to set your tier." },
              { icon: <Sparkles className="w-3.5 h-3.5" />, title: "Perks apply", body: "Discounts, daily credits and unlocks activate automatically while you qualify." },
            ].map((s, i) => (
              <div key={i} className="rounded-md border border-border/40 bg-card/40 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-violet-200">
                  {s.icon}
                  <span className="font-orbitron text-[10px] tracking-wider uppercase">{i + 1}. {s.title}</span>
                </div>
                <p className="mt-1 font-mono-share text-[10px] text-foreground/75 leading-snug">{s.body}</p>
              </div>
            ))}
          </section>

          {/* Tier ladder */}
          <section className="mt-5">
            <h3 className="font-orbitron text-[10px] tracking-widest uppercase text-pink-200 flex items-center gap-1.5 mb-2">
              <Zap className="w-3 h-3" /> Tier Ladder
            </h3>
            <ul className="space-y-1.5">
              {tiers.map(t => (
                <li
                  key={t.id}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-md border border-border/40 bg-card/40 hover:border-violet-500/30 transition-colors"
                >
                  <HolderBadge tier={t.id as HolderTierId} tierName={t.name} size="sm" showStreak={false} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono-share text-[10px] text-muted-foreground/80 tabular-nums">
                        ≥ {(t.minHeld / 1_000_000).toLocaleString()}M XRGE
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono-share text-[10px] text-foreground/80 leading-snug">
                      {t.description}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-orbitron text-[11px] text-secondary font-bold tabular-nums">+{t.discountPercent}%</div>
                    {t.dailyCreditBonus > 0 && (
                      <div className="font-mono-share text-[9px] text-secondary/80 tabular-nums">+{t.dailyCreditBonus}/day</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 font-mono-share text-[10px] text-muted-foreground/70 leading-snug">
              Tiers are denominated in XRGE so early holders are rewarded even as price moves. Sell below your tier and you drop down — and your streak resets.
            </p>
          </section>

          {/* Streak multiplier */}
          <section className="mt-5">
            <h3 className="font-orbitron text-[10px] tracking-widest uppercase text-orange-200 flex items-center gap-1.5 mb-2">
              <Flame className="w-3 h-3" /> Continuous-Hold Streak
            </h3>
            <p className="font-mono-share text-[10px] text-foreground/80 leading-snug mb-2">
              The longer you hold without dropping a tier, the higher your <span className="text-orange-300 font-bold">streak multiplier</span> — applied on top of your base discount and daily credit bonus.
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {streaks.map(s => (
                <li
                  key={s.days}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/40 bg-card/40"
                >
                  <Clock className={`w-3.5 h-3.5 ${s.days >= 30 ? "text-orange-300" : "text-muted-foreground/50"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-orbitron text-[10px] uppercase tracking-wider text-foreground/90">
                      {s.label}
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground/70">
                      {s.description}
                    </div>
                  </div>
                  <div className="font-orbitron text-[11px] font-bold text-orange-300 tabular-nums">
                    ×{s.multiplier.toFixed(2)}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 font-mono-share text-[10px] text-muted-foreground/70 leading-snug">
              Example: an <span className="text-violet-200">Architect</span> with a 180-day streak earns <span className="text-secondary font-bold">+50% off</span> generations and <span className="text-secondary font-bold">+20 daily credits</span>.
            </p>
          </section>

          {/* CTAs */}
          <section className="mt-5 flex flex-wrap items-center gap-2">
            <a
              href={XRGE_DEXSCREENER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-[10px] font-orbitron uppercase tracking-wider shadow-glow-live"
            >
              Buy XRGE on DexScreener
              <ExternalLink className="w-3 h-3" />
            </a>
            {onOpenBank && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { onOpenChange(false); onOpenBank(); }}
                className="font-orbitron text-[10px] tracking-wider gap-1.5 border-violet-500/30 text-violet-200 hover:bg-violet-500/15 hover:text-violet-100"
              >
                <Wallet className="w-3 h-3" />
                Open XRGE Bank
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="ml-auto font-orbitron text-[10px] tracking-wider text-muted-foreground hover:text-foreground"
            >
              Close
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default HolderProgramDialog;

import React, { useEffect, useState } from "react";
import { Diamond, Wallet, Flame, ChevronRight, BookOpen } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { HOLDER_TIERS } from "@/lib/holderTiers";
import { XRGE_DEXSCREENER_URL } from "@/lib/xrgePublic";
import HolderBadge, { type HolderTierId } from "@/components/HolderBadge";
import HolderProgramDialog from "@/components/HolderProgramDialog";
import { Button } from "@/components/ui/button";

interface HolderState {
  tier: string;
  tierName: string;
  totalHeld: number;
  effectiveDiscount: number;
  effectiveDailyBonus: number;
  streakDays: number;
  streakBonus: { multiplier: number; label: string };
  nextTier: { name: string; minHeld: number; xrgeRemaining: number } | null;
}

interface Props {
  /** Open the XRGE Bank dialog (typically closes the store first). */
  onOpenBank: () => void;
}

/**
 * Compact Holder Program promo for the Store dialog.
 * Surfaces current tier (if any), next-tier hint, and a CTA into the
 * XRGE Bank → Holder tab. Falls back to a discovery card for non-holders
 * and unauthenticated users.
 */
const HolderProgramPromo: React.FC<Props> = ({ onOpenBank }) => {
  const [holder, setHolder] = useState<HolderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [learnOpen, setLearnOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/v1/xrge-balance");
        if (cancelled) return;
        if (res?.holder) setHolder(res.holder as HolderState);
      } catch {
        // unauthenticated or endpoint unavailable — render discovery card
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tierKey = (holder?.tier ?? "none") as HolderTierId;
  const isHolder = !!holder && tierKey !== "none";

  // Top-3 perks shown as compact pills
  const tiers = HOLDER_TIERS.filter(t => t.id !== "none").slice().reverse();

  return (
    <section
      aria-label="XRGE Holder Program"
      className="mt-3 rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-card/60 to-pink-500/10 px-3 py-2.5 shadow-[0_0_18px_hsl(280_80%_60%/0.15)]"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-violet-400/40 bg-violet-500/15 text-violet-300">
          <Diamond className="h-3.5 w-3.5" strokeWidth={2.5} />
        </div>
        <span className="font-orbitron text-[11px] tracking-widest text-violet-200 font-bold uppercase">
          Holder Program
        </span>
        {isHolder && holder && (
          <span className="inline-flex items-center gap-1.5">
            <HolderBadge
              tier={tierKey}
              tierName={holder.tierName}
              streakDays={holder.streakDays}
              size="xs"
            />
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLearnOpen(true)}
            className="shrink-0 font-orbitron text-[9px] tracking-wider gap-1 text-muted-foreground hover:text-violet-200"
          >
            <BookOpen className="w-3 h-3" />
            Learn
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenBank}
            className="shrink-0 font-orbitron text-[9px] tracking-wider gap-1.5 border-violet-500/30 text-violet-200 hover:bg-violet-500/15 hover:text-violet-100"
          >
            <Wallet className="w-3 h-3" />
            XRGE Bank
            <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Body — current holder summary OR discovery copy */}
      {loading ? (
        <div className="mt-2 h-6 rounded bg-card/40 animate-pulse" />
      ) : isHolder && holder ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-share text-[10px] text-foreground/85">
            <span>
              Holding{" "}
              <span className="text-violet-200 font-bold tabular-nums">
                {Math.round(holder.totalHeld).toLocaleString()}
              </span>{" "}
              XRGE
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>
              <span className="text-secondary font-bold">+{holder.effectiveDiscount}%</span> gen discount
            </span>
            {holder.effectiveDailyBonus > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>
                  <span className="text-secondary font-bold">+{holder.effectiveDailyBonus}</span> daily credits
                </span>
              </>
            )}
            {holder.streakDays >= 30 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1 text-orange-300">
                  <Flame className="w-3 h-3" />
                  {holder.streakDays}d streak ×{holder.streakBonus.multiplier.toFixed(2)}
                </span>
              </>
            )}
          </div>
          {holder.nextTier && holder.nextTier.xrgeRemaining > 0 && (
            <p className="font-mono-share text-[10px] text-muted-foreground/80 leading-snug">
              Hold{" "}
              <span className="text-violet-200 font-bold tabular-nums">
                {Math.round(holder.nextTier.xrgeRemaining).toLocaleString()}
              </span>{" "}
              more XRGE to reach{" "}
              <span className="text-violet-200 font-bold uppercase">{holder.nextTier.name}</span>.{" "}
              <a
                href={XRGE_DEXSCREENER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-pink-300 underline underline-offset-2"
              >
                Buy XRGE
              </a>
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="font-mono-share text-[10px] text-foreground/85 leading-snug">
            Hold <span className="text-violet-200 font-bold">XRGE</span> to unlock up to{" "}
            <span className="text-secondary font-bold">+25% off</span>,{" "}
            <span className="text-secondary font-bold">+10 daily credits</span>, NSFW LoRAs and GLTCH PRO.
            Continuous holders earn streak multipliers up to ×2.{" "}
            <a
              href={XRGE_DEXSCREENER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-pink-300 underline underline-offset-2"
            >
              Buy XRGE
            </a>
          </p>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {tiers.map(t => (
              <li
                key={t.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-border/40 bg-card/40"
                title={t.description}
              >
                <HolderBadge tier={t.id as HolderTierId} size="xs" showLabel={false} showStreak={false} />
                <div className="min-w-0 leading-tight">
                  <div className="font-orbitron text-[9px] uppercase tracking-wider text-foreground/90 truncate">
                    {t.name}
                  </div>
                  <div className="font-mono-share text-[9px] text-muted-foreground/70 tabular-nums">
                    ≥ {(t.minHeld / 1_000_000).toLocaleString()}M
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default HolderProgramPromo;

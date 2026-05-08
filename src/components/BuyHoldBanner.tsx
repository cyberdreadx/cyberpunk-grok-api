import React, { useState } from "react";
import { Diamond, X, ChevronDown, ChevronUp, ExternalLink, Flame } from "lucide-react";
import { HOLDER_TIERS } from "@/lib/holderTiers";
import { XRGE_DEXSCREENER_URL } from "@/lib/xrgePublic";
import HolderBadge from "@/components/HolderBadge";

const STORAGE_KEY = "buy_hold_banner_dismissed_v1";

/**
 * Promotional banner for the XRGE Buy & Hold Program.
 * Surfaced on the Index page so new users can discover holder perks
 * (gen discounts, bonus daily credits, NSFW/GLTCH PRO unlocks, streak bonuses).
 *
 * Dismissible — preference persisted in localStorage.
 */
const BuyHoldBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  // Show tiers from lowest unlock → highest, skip 'none'
  const tiers = HOLDER_TIERS.filter(t => t.id !== "none").slice().reverse();

  return (
    <section
      aria-label="XRGE Buy and Hold Program"
      className="relative overflow-hidden rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 via-card/60 to-secondary/10 shadow-[0_0_24px_hsl(var(--primary)/0.12)] animate-slide-up"
    >
      {/* Glitch corner accent */}
      <div className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full bg-secondary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-primary/15 blur-3xl" />

      <div className="relative px-4 py-3 sm:px-5 sm:py-4">
        <button
          onClick={dismiss}
          aria-label="Dismiss buy and hold banner"
          className="absolute top-2 right-2 p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-card/40 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div className="shrink-0 mt-0.5 w-9 h-9 rounded-md border border-primary/40 bg-primary/10 flex items-center justify-center text-primary shadow-[0_0_10px_hsl(var(--primary)/0.3)]">
            <Diamond className="w-4 h-4" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-orbitron uppercase tracking-widest text-[11px] sm:text-xs text-primary">
                Buy &amp; Hold Program
              </h2>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-secondary/40 bg-secondary/10 text-[8px] sm:text-[9px] font-mono-share uppercase tracking-wider text-secondary">
                <Flame className="w-2.5 h-2.5" /> Streak ×2
              </span>
            </div>
            <p className="mt-1 text-[11px] sm:text-xs text-foreground/80 font-mono-share leading-relaxed">
              Hold <span className="text-primary font-bold">XRGE</span> to unlock up to{" "}
              <span className="text-secondary font-bold">+25% gen discount</span>,{" "}
              <span className="text-secondary font-bold">+10 daily credits</span>, NSFW LoRAs and GLTCH PRO. Continuous holders earn streak multipliers up to ×2.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={XRGE_DEXSCREENER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-[10px] sm:text-[11px] font-orbitron uppercase tracking-wider shadow-[0_0_12px_hsl(var(--primary)/0.4)]"
              >
                Buy XRGE
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border/60 bg-card/40 hover:bg-card/70 transition-colors text-[10px] sm:text-[11px] font-orbitron uppercase tracking-wider text-foreground/80"
              >
                {expanded ? "Hide tiers" : "See tiers"}
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {expanded && (
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 animate-slide-up">
                {tiers.map(t => (
                  <li
                    key={t.id}
                    className="flex items-start gap-2 px-2.5 py-2 rounded border border-border/40 bg-card/40"
                  >
                    <HolderBadge tier={t.id as any} tierName={t.name} size="xs" showStreak={false} showLabel={false} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-[10px] font-orbitron uppercase tracking-wider text-foreground">
                          {t.name}
                        </span>
                        <span className="text-[9px] font-mono-share text-muted-foreground/70">
                          ≥ {(t.minHeld / 1_000_000).toLocaleString()}M XRGE
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] font-mono-share text-foreground/70 leading-snug">
                        {t.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default BuyHoldBanner;

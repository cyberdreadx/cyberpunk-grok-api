import React from "react";
import { Award, Star, Crown, Gem, Flame, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type HolderTierId = "none" | "initiate" | "operative" | "runner" | "architect";

interface HolderBadgeProps {
  tier: HolderTierId | string;
  tierName?: string;
  streakDays?: number;
  /** When provided, overrides the auto-generated tooltip */
  title?: string;
  /** Size of the badge icon */
  size?: "xs" | "sm" | "md" | "lg";
  /** Whether to render the tier name next to the icon */
  showLabel?: boolean;
  /** Show streak flame indicator if streak >= 30 days */
  showStreak?: boolean;
  className?: string;
}

const SIZE: Record<NonNullable<HolderBadgeProps["size"]>, { icon: string; text: string; gap: string; pad: string }> = {
  xs: { icon: "w-3 h-3", text: "text-[8px]", gap: "gap-0.5", pad: "px-1 py-0.5" },
  sm: { icon: "w-3.5 h-3.5", text: "text-[9px]", gap: "gap-1", pad: "px-1.5 py-0.5" },
  md: { icon: "w-4 h-4", text: "text-[10px]", gap: "gap-1", pad: "px-2 py-1" },
  lg: { icon: "w-5 h-5", text: "text-xs", gap: "gap-1.5", pad: "px-2.5 py-1.5" },
};

const TIER_ICON: Record<string, LucideIcon> = {
  initiate: Award,
  operative: Star,
  runner: Crown,
  architect: Gem,
  none: Sparkles,
};

const TIER_STYLE: Record<string, string> = {
  initiate: "text-amber-300 border-amber-500/40 bg-amber-500/10 shadow-glow-focus",
  operative: "text-cyan-300 border-cyan-400/40 bg-cyan-500/10 shadow-glow-focus",
  runner: "text-violet-300 border-violet-400/40 bg-violet-500/10 shadow-glow-focus",
  architect: "text-pink-300 border-pink-400/50 bg-pink-500/15 shadow-glow-live",
  none: "text-muted-foreground/60 border-border/30 bg-card/30",
};

const TIER_DEFAULT_NAME: Record<string, string> = {
  initiate: "Initiate",
  operative: "Operative",
  runner: "Runner",
  architect: "Architect",
  none: "—",
};

/**
 * XRGE Holder tier badge — displayed next to usernames or in profile cards
 * to signify long-term holder status. Includes optional streak flame for
 * holders who've held continuously for 30+ days.
 */
const HolderBadge: React.FC<HolderBadgeProps> = ({
  tier,
  tierName,
  streakDays = 0,
  title,
  size = "sm",
  showLabel = true,
  showStreak = true,
  className,
}) => {
  const tierKey = (tier in TIER_ICON ? tier : "none") as string;
  const Icon = TIER_ICON[tierKey];
  const style = TIER_STYLE[tierKey];
  const name = tierName || TIER_DEFAULT_NAME[tierKey] || tier;
  const sizing = SIZE[size];

  const tooltip =
    title ||
    (tierKey === "none"
      ? "Hold ≥ 1M XRGE to unlock holder perks"
      : `${name} holder${streakDays > 0 ? ` · ${streakDays}d streak` : ""}`);

  const showFlame = showStreak && streakDays >= 30;

  if (!showLabel) {
    return (
      <span
        title={tooltip}
        className={cn("inline-flex items-center justify-center rounded-full border", sizing.pad, style, className)}
      >
        <Icon className={sizing.icon} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center font-orbitron tracking-wider rounded-full border uppercase",
        sizing.gap,
        sizing.pad,
        sizing.text,
        style,
        className,
      )}
    >
      <Icon className={sizing.icon} strokeWidth={2.5} />
      <span>{name}</span>
      {showFlame && (
        <span title={`${streakDays}-day continuous hold streak`} className="inline-flex items-center gap-0.5 ml-0.5 text-orange-400">
          <Flame className={cn(sizing.icon, "drop-shadow-glow-focus")} strokeWidth={2.5} />
          {size !== "xs" && <span className="text-orange-300">{streakDays}d</span>}
        </span>
      )}
    </span>
  );
};

export default HolderBadge;

// ── Helper: top-tier flair on usernames (used in feed/profile) ───────────
export const isTopHolder = (tier: HolderTierId | string): boolean =>
  tier === "runner" || tier === "architect";

/**
 * The earn/ambassador promo strip.
 *
 * Placed on the surfaces people actually sit on — feed, create, profile — and
 * written to match where they are in the funnel, because a single generic
 * "invite friends" line is what everyone already ignores. Someone who has
 * personally sent three paying customers should be asked to take cash, not
 * reminded that credits exist.
 *
 * Copying the link is inline rather than a link to a page that has a copy
 * button. Every hop between "I'd share this" and having the link in the
 * clipboard costs conversions, and the whole point of the placement is to
 * remove them.
 *
 * Dismiss hides it for a week rather than forever: this is a promo, and a
 * permanently killable one stops being marketing after the first day.
 */

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Check, X, DollarSign, Gift, Sparkles, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useEarnStatus } from "@/hooks/useEarnStatus";
import { useToast } from "@/hooks/use-toast";

const SNOOZE_KEY = "gltch-earn-promo-snooze";
const SNOOZE_DAYS = 7;

function snoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400_000));
  } catch {
    /* ignore */
  }
}

interface Props {
  /** "strip" for in-feed placement, "card" for sidebars and page bodies. */
  variant?: "strip" | "card";
  className?: string;
}

export default function EarnPromoBanner({ variant = "strip", className = "" }: Props) {
  const { isAuthenticated } = useAuth();
  const { status, loading } = useEarnStatus(isAuthenticated);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [hidden, setHidden] = useState(() => snoozed());
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    if (!status.link) return;
    navigator.clipboard.writeText(status.link);
    setCopied(true);
    toast({
      title: "Link copied",
      description: status.isAmbassador
        ? `You earn ${status.commissionPct}% of everything they spend.`
        : "You earn credits when someone signs up and buys through it.",
    });
    setTimeout(() => setCopied(false), 2000);
  }, [status, toast]);

  // Funnel-aware copy. Ordered most- to least-qualified so the strongest ask
  // someone qualifies for is the one they see.
  const pitch = useMemo(() => {
    if (status.isAmbassador && status.ambassadorStatus === "active") {
      return {
        icon: DollarSign,
        tone: "cash" as const,
        headline: `You earn ${status.commissionPct}% cash on every sale`,
        sub: "Share your ambassador link — commission lands in your balance automatically.",
        cta: "MY EARNINGS",
        onCta: () => navigate("/ambassador"),
        showCopy: true,
      };
    }
    if (status.applicationStatus === "pending") {
      return {
        icon: Sparkles,
        tone: "neutral" as const,
        headline: "Ambassador application under review",
        sub: "Meanwhile your referral link still earns credits on every friend who buys.",
        cta: "VIEW STATUS",
        onCta: () => navigate("/ambassador"),
        showCopy: true,
      };
    }
    if (status.totalPurchased >= 2) {
      return {
        icon: TrendingUp,
        tone: "cash" as const,
        headline: `You've already sent ${status.totalPurchased} paying customers`,
        sub: "Ambassadors get paid 20% cash on all of it. Applications are reviewed by hand.",
        cta: "APPLY NOW",
        onCta: () => navigate("/ambassador"),
        showCopy: false,
      };
    }
    if (status.totalReferred > 0) {
      return {
        icon: Gift,
        tone: "credits" as const,
        headline: `${status.totalReferred} signed up with your link`,
        sub: "You earn 10 credits every time one of them buys — and a free month if they subscribe.",
        cta: "MY REFERRALS",
        onCta: () => navigate("/referral"),
        showCopy: true,
      };
    }
    return {
      icon: DollarSign,
      tone: "cash" as const,
      headline: "Get paid to share GLTCH",
      sub: "Earn credits on every friend who buys — or become an ambassador and take 20% in cash.",
      cta: "LEARN MORE",
      onCta: () => navigate("/ambassador"),
      showCopy: true,
    };
  }, [status, navigate]);

  if (!isAuthenticated || hidden || loading) return null;
  // Nothing to promote until a link exists to promote.
  if (!status.link) return null;

  const Icon = pitch.icon;
  const accent =
    pitch.tone === "cash" ? "text-green-400"
    : pitch.tone === "credits" ? "text-primary"
    : "text-muted-foreground";
  const glow =
    pitch.tone === "cash" ? "border-green-500/40 bg-gradient-to-r from-green-500/15 via-green-500/5 to-transparent"
    : pitch.tone === "credits" ? "border-primary/40 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent"
    : "border-border/60 bg-card/60";

  return (
    <div
      className={`relative rounded-lg border ${glow} backdrop-blur-sm ${
        variant === "strip" ? "p-3 sm:p-4" : "p-4"
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => { snooze(); setHidden(true); }}
        aria-label="Dismiss"
        className="absolute top-2 right-2 p-1 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0 bg-background/40 ${accent}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className={`font-orbitron text-xs sm:text-sm tracking-wide ${accent}`}>{pitch.headline}</p>
            <p className="font-mono-share text-[10px] sm:text-[11px] text-muted-foreground/80 leading-relaxed mt-0.5">
              {pitch.sub}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {pitch.showCopy && (
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border/60 bg-background/40 font-mono-share text-[10px] text-foreground/80 hover:border-foreground/30 transition-colors max-w-full"
              >
                {copied ? <Check className="w-3 h-3 text-green-400 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
                <span className="truncate">{copied ? "COPIED" : status.link.replace(/^https?:\/\//, "")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={pitch.onCta}
              className={`px-3 py-1.5 rounded font-orbitron text-[10px] tracking-widest transition-colors ${
                pitch.tone === "cash"
                  ? "bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/40"
                  : "bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40"
              }`}
            >
              {pitch.cta}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

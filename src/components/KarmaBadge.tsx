/**
 * KarmaBadge — surfaces the user's posting eligibility.
 * Two paths unlock posting: a real purchase, OR earning enough karma
 * (engagement + verified email + minimum account age).
 *
 * Props are read directly from the auth user's `posting` payload returned by /auth/me.
 */
import React from "react";
import { Sparkles, Lock, ShieldCheck, ShoppingCart, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PostingStatus } from "@/hooks/useAuth";

interface KarmaBadgeProps {
  posting?: PostingStatus;
  onOpenStore?: () => void;
  /** Compact variant — single-line, no progress text. */
  compact?: boolean;
}

const KarmaBadge: React.FC<KarmaBadgeProps> = ({ posting, onOpenStore, compact }) => {
  if (!posting) return null;

  const { can_post, purchased, karma, karma_threshold, karma_unlock_ok, email_verified, account_age_hours, min_account_age_hours } = posting;

  // Already unlocked — show celebratory state.
  if (can_post) {
    const reason = purchased ? "Purchase" : "Karma";
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border border-primary/30 bg-primary/5 ${
          compact ? "text-[10px]" : "text-[11px]"
        } font-mono-share text-primary`}
      >
        <ShieldCheck className="w-3 h-3" />
        <span className="uppercase tracking-wider">Posting unlocked</span>
        <span className="text-primary/60">·</span>
        <span className="text-primary/80">{reason}</span>
        {!purchased && (
          <>
            <span className="text-primary/60">·</span>
            <Sparkles className="w-3 h-3" />
            <span>{karma}</span>
          </>
        )}
      </div>
    );
  }

  const pct = Math.min(100, Math.round((karma / Math.max(1, karma_threshold)) * 100));
  const remaining = Math.max(0, karma_threshold - karma);
  const ageRemaining = Math.max(0, min_account_age_hours - account_age_hours);

  return (
    <div className="rounded border border-border/50 bg-card/40 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-mono-share text-[10px] uppercase tracking-wider text-muted-foreground">
          Posting locked
        </span>
        <Sparkles className="w-3 h-3 text-secondary ml-auto" />
        <span className="font-mono-share text-[11px] text-foreground/80">
          {karma} <span className="text-muted-foreground/60">/ {karma_threshold} karma</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-muted/30 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-secondary to-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {!compact && (
        <p className="font-mono-share text-[10px] text-muted-foreground leading-relaxed">
          Earn karma by upvoting, commenting, and receiving upvotes on the feed.
          {remaining > 0 && <> Need <span className="text-foreground/80">{remaining}</span> more.</>}
          {!email_verified && <> Verify your email to count.</>}
          {ageRemaining > 0 && <> Account must be at least {min_account_age_hours}h old ({Math.ceil(ageRemaining)}h to go).</>}
          {karma >= karma_threshold && email_verified && ageRemaining === 0 && !karma_unlock_ok && (
            <> Almost there.</>
          )}
        </p>
      )}

      {onOpenStore && (
        <Button
          size="sm"
          variant="outline"
          onClick={onOpenStore}
          className="w-full h-7 font-mono-share text-[10px] border-primary/30 hover:bg-primary/5 hover:text-primary gap-1.5"
        >
          <ShoppingCart className="w-3 h-3" />
          Or unlock instantly with a credit purchase
          <ArrowRight className="w-3 h-3 ml-auto" />
        </Button>
      )}
    </div>
  );
};

export default KarmaBadge;

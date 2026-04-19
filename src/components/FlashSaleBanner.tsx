/**
 * FlashSaleBanner — sitewide top banner shown when a flash sale is active.
 * Click opens the store. Dismissable for the session.
 */
import { useState } from "react";
import { Flame, X } from "lucide-react";
import { useFlashSale } from "@/hooks/useFlashSale";

interface FlashSaleBannerProps {
  onClick?: () => void;
}

const DISMISS_KEY = "gltch-flashsale-dismissed";

export default function FlashSaleBanner({ onClick }: FlashSaleBannerProps) {
  const { sale, timeLeft, expired } = useFlashSale();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  if (!sale || expired) return null;
  if (dismissed === sale.id) return null;

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { sessionStorage.setItem(DISMISS_KEY, sale.id); } catch { /* ignore */ }
    setDismissed(sale.id);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-lg border border-orange-500/50 bg-gradient-to-r from-orange-600/20 via-pink-500/15 to-orange-600/20 px-4 py-2.5 text-left animate-slide-up hover:border-orange-400/70 transition-colors"
    >
      {/* Animated shimmer */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-orange-300/20 to-transparent group-hover:animate-[shimmer_1.5s_ease-in-out] [animation-name:shimmer] [animation-duration:3s] [animation-iteration-count:infinite]" style={{ animation: "shimmer 3s ease-in-out infinite" }} />

      <div className="relative flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500/25 ring-2 ring-orange-400/50">
          <Flame className="h-4 w-4 text-orange-300 animate-pulse" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-orbitron text-[10px] sm:text-xs tracking-widest text-orange-200 font-bold">
              ⚡ FLASH SALE
            </span>
            <span className="font-mono-share text-[10px] sm:text-xs text-orange-100/90 truncate">
              {sale.title}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
            {sale.discount_percent > 0 && (
              <span className="font-orbitron text-[10px] sm:text-xs font-bold text-yellow-300">
                {sale.discount_percent}% OFF
              </span>
            )}
            {sale.bonus_credits_percent > 0 && (
              <span className="font-orbitron text-[10px] sm:text-xs font-bold text-green-300">
                +{sale.bonus_credits_percent}% BONUS
              </span>
            )}
            <span className="font-mono-share text-[9px] sm:text-[10px] text-orange-200/70">
              ends in <span className="text-orange-100 font-bold tabular-nums">{timeLeft}</span>
            </span>
          </div>
        </div>

        <span className="hidden sm:inline-flex shrink-0 px-3 py-1.5 rounded-md bg-orange-500/30 border border-orange-400/50 font-orbitron text-[10px] tracking-wider text-orange-100 group-hover:bg-orange-500/50">
          OPEN STORE
        </span>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded text-orange-200/60 hover:text-orange-100 hover:bg-orange-500/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </button>
  );
}

/**
 * Krea2LaunchBanner — announces the Krea 2 Turbo image engine.
 *
 * Dismissable (persisted in localStorage). Optional onClick jumps straight to
 * the engine, so the banner is a route to the thing rather than only an
 * advert for it.
 *
 * The dismiss key carries a version, for the reason the LTX banner learned:
 * bump it when the banner starts saying something materially new, or everyone
 * who dismissed the previous announcement never sees the next one.
 */
import { useState } from "react";
import { Sparkles, X } from "lucide-react";

const DISMISS_KEY = "gltch-krea2-launch-dismissed-v1";

interface Krea2LaunchBannerProps {
  onClick?: () => void;
}

export default function Krea2LaunchBanner({ onClick }: Krea2LaunchBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  if (dismissed) return null;

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    setDismissed(true);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-lg border border-cyan-400/50 bg-gradient-to-r from-cyan-500/15 via-cyan-400/10 to-cyan-500/15 px-4 py-2.5 text-left animate-slide-up hover:border-cyan-300/70 transition-colors"
    >
      <div className="relative flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/25 ring-2 ring-cyan-400/50">
          <Sparkles className="h-4 w-4 text-cyan-300 animate-pulse" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-orbitron text-[10px] sm:text-xs tracking-widest text-cyan-200 font-bold">
              ✨ NEW — KREA 2
            </span>
            <span className="font-mono-share text-[10px] sm:text-xs text-cyan-100/90 truncate">
              Photoreal image engine, live now
            </span>
          </div>
          <div className="mt-0.5 font-mono-share text-[9px] sm:text-[10px] text-cyan-200/70">
            Krea 2 Turbo · film-grade realism · any shape up to 1MP · 3 cr
          </div>
        </div>

        <span className="hidden sm:inline-flex shrink-0 px-3 py-1.5 rounded-md bg-cyan-500/30 border border-cyan-400/50 font-orbitron text-[10px] tracking-wider text-cyan-100 group-hover:bg-cyan-500/50">
          TRY KREA 2
        </span>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded text-cyan-200/60 hover:text-cyan-100 hover:bg-cyan-500/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </button>
  );
}

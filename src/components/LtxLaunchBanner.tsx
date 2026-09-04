/**
 * LtxLaunchBanner — announces the LTX-2.3 video engine.
 *
 * Dismissable (persisted in localStorage). Optional onClick (jumps to the LTX
 * engine). The dismiss key carries a version: bump it when the banner starts
 * saying something materially new, or everyone who dismissed the previous
 * announcement never sees the next one. Bumped to v2 for native HD and 15s
 * clips — the copy had been advertising "2-7s" since June.
 */
import { useState } from "react";
import { Volume2, X } from "lucide-react";

const DISMISS_KEY = "gltch-ltx-launch-dismissed-v2";

interface LtxLaunchBannerProps {
  onClick?: () => void;
}

export default function LtxLaunchBanner({ onClick }: LtxLaunchBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  if (dismissed) return null;

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-lg border border-amber-400/50 bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-amber-500/15 px-4 py-2.5 text-left animate-slide-up hover:border-amber-300/70 transition-colors"
    >
      <div className="relative flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/25 ring-2 ring-amber-400/50">
          <Volume2 className="h-4 w-4 text-amber-300 animate-pulse" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-orbitron text-[10px] sm:text-xs tracking-widest text-amber-200 font-bold">
              ✨ UPGRADED — LTX-2.3
            </span>
            <span className="font-mono-share text-[10px] sm:text-xs text-amber-100/90 truncate">
              Sharper video, now up to 15 seconds
            </span>
          </div>
          <div className="mt-0.5 font-mono-share text-[9px] sm:text-[10px] text-amber-200/70">
            Native HD up to 1664×960 · synced audio in one pass · pick 2–15s · 7 cr/s
          </div>
        </div>

        <span className="hidden sm:inline-flex shrink-0 px-3 py-1.5 rounded-md bg-amber-500/30 border border-amber-400/50 font-orbitron text-[10px] tracking-wider text-amber-100 group-hover:bg-amber-500/50">
          TRY LTX
        </span>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded text-amber-200/60 hover:text-amber-100 hover:bg-amber-500/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </button>
  );
}

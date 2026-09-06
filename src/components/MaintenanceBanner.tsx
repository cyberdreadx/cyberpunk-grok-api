/**
 * MaintenanceBanner — site-wide status strip, mounted above <Routes> in App.tsx.
 *
 * Currently announcing recovery from the 2026-09-05 generation outage: a syntax
 * error in the ComfyUI handler returned 500 on every generate call for 17h49m
 * (fix: 91fe852). 71 people hit it and got nothing but "internal server error",
 * so they deserve to be told plainly what happened and that it cost them
 * nothing — verified against usage_log, which recorded zero charges across the
 * whole window.
 *
 * Two things the previous version of this banner lacked, both learned the hard
 * way:
 *
 *   Dismissal persists. The old one held state in useState, so it came back on
 *   every navigation and every reload — a bar you cannot get rid of reads as
 *   broken, not as informative.
 *
 *   It expires on its own. An apology still on the site a week later is worse
 *   than no apology at all, and nobody remembers to take these down. After
 *   EXPIRES_AT it renders nothing regardless of dismissal, so removing the
 *   component is tidying rather than a deadline.
 */
import { useState } from "react";
import { CheckCircle2, X } from "lucide-react";

// Bump with the message. Reusing a key means everyone who dismissed the last
// announcement silently never sees the next one.
const DISMISS_KEY = "gltch-status-2026-09-06-restored";

/** Stops showing itself here, whether or not anyone dismissed it. */
const EXPIRES_AT = Date.parse("2026-09-10T00:00:00Z");

const MaintenanceBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  if (dismissed || Date.now() > EXPIRES_AT) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="relative z-50 flex items-center justify-center gap-2.5 px-4 py-2 border-b border-green-500/40 bg-green-500/10 text-green-100"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />

      <p className="text-center text-[11px] leading-tight sm:text-xs">
        <span className="font-orbitron tracking-widest uppercase text-green-300">
          All systems operational
        </span>
        <span className="mx-2 hidden text-green-500/50 sm:inline">·</span>
        <span className="block sm:inline font-mono-share text-green-100/80">
          Generation was down for about 18 hours and is now fully restored.
          Sorry for the trouble — no credits were charged for anything that failed.
        </span>
      </p>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss status message"
        className="shrink-0 rounded p-0.5 text-green-200/60 transition-colors hover:bg-green-500/20 hover:text-green-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default MaintenanceBanner;

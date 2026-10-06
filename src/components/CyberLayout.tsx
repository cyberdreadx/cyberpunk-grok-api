import React, { useEffect } from "react";
import AppTopBar, { TOP_BAR_PX } from "@/components/AppTopBar";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/hooks/useAuth";
import { BARE_THEME_ID } from "@/lib/themes";
import { applyImmersionToRoot, BARE_IMMERSION, DEFAULT_IMMERSION, fetchMasterImmersion } from "@/lib/immersion";

interface CyberLayoutProps {
  children: React.ReactNode;
  /** Top bar title; defaults to the route's name. */
  title?: string;
  /** The page's own store, if it has one. */
  onOpenStore?: () => void;
  /** Pages that render their own MobileBottomNav (with page-specific
   *  handlers) set this so it is not drawn twice. Everything else gets the
   *  standard one, so no page is left without navigation on a phone. */
  ownBottomNav?: boolean;
}

const CyberLayout: React.FC<CyberLayoutProps> = ({ children, title, onOpenStore, ownBottomNav }) => {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (document.documentElement.dataset.cyberTheme === BARE_THEME_ID) {
      applyImmersionToRoot(BARE_IMMERSION);
    } else {
      fetchMasterImmersion()
        .then(applyImmersionToRoot)
        .catch(() => applyImmersionToRoot(DEFAULT_IMMERSION));
    }

    // Signal to globally-positioned UI (e.g. MobileCreditsPill) that a
    // terminal bar is present so they can offset their top position and
    // avoid overlapping the macOS-style title row.
    document.documentElement.dataset.cyberTerminal = "1";
    return () => {
      delete document.documentElement.dataset.cyberTerminal;
    };
  }, []);

  return (
    <div className="relative min-h-svh cyber-gradient overflow-x-hidden immersion-screen-host">
      {/* Static pulse tint only — no CSS animation (full-viewport keyframes = main-thread cost) */}
      <div className="fixed inset-0 z-[25] pointer-events-none immersion-pulse-layer" aria-hidden />

      {/* CRT scanline overlay — opacity driven by --immersion-scanline */}
      <div className="fixed inset-0 scanline z-10 pointer-events-none" />

      {/* Vignette edges — strength driven by --immersion-vignette */}
      <div className="fixed inset-0 z-10 pointer-events-none immersion-vignette" />

      {/* Grid background */}
      <div
        className="cyber-grid-bg fixed inset-0 opacity-[0.03] z-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--primary)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Corner frame decorations */}
      <div className="cyber-corner-frame fixed top-0 left-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-primary/40 to-transparent" />
        <div className="absolute top-0 left-0 h-full w-[1px] bg-gradient-to-b from-primary/40 to-transparent" />
      </div>
      <div className="cyber-corner-frame fixed top-0 right-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute top-0 right-0 w-full h-[1px] bg-gradient-to-l from-primary/40 to-transparent" />
        <div className="absolute top-0 right-0 h-full w-[1px] bg-gradient-to-b from-primary/40 to-transparent" />
      </div>
      <div className="cyber-corner-frame fixed bottom-0 left-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-primary/40 to-transparent" />
        <div className="absolute bottom-0 left-0 h-full w-[1px] bg-gradient-to-t from-primary/40 to-transparent" />
      </div>
      <div className="cyber-corner-frame fixed bottom-0 right-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute bottom-0 right-0 w-full h-[1px] bg-gradient-to-l from-primary/40 to-transparent" />
        <div className="absolute bottom-0 right-0 h-full w-[1px] bg-gradient-to-t from-primary/40 to-transparent" />
      </div>

      {/* The app bar: title, back, credits, notifications. */}
      <AppTopBar title={title} onOpenStore={onOpenStore} />

      {/* Horizontal scan line — desktop only (animation + layer cost) */}
      <div
        className="cyber-hud-scanline fixed left-0 right-0 h-[1px] z-[15] opacity-20 pointer-events-none hidden md:block"
        style={{
          background: "linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)",
          animation: "hud-scan 8s linear infinite",
        }}
      />

      {/* HUD overlay */}
      {/* HudOverlay retired from the layout. Its four fixed corner blocks — 10-20%
          opacity telemetry text, desktop only, z-30 above content — collided with
          something real in every corner: the menu button top-left, page controls
          such as MY PROFILE top-right, the credit toast bottom-left and the help
          button bottom-right. The component is kept if it ever finds a home. */}

      {/* Main content — offset by the app bar height + safe area */}
      <div
        className="cyber-main-padding relative z-20"
        style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + ${TOP_BAR_PX}px)` }}
      >{children}</div>

      {!ownBottomNav && <MobileBottomNav isAuthenticated={isAuthenticated} />}
    </div>
  );
};

export default CyberLayout;

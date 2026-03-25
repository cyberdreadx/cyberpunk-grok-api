import React, { useEffect } from "react";
import HudOverlay from "@/components/HudOverlay";
import { BARE_THEME_ID } from "@/lib/themes";
import { applyImmersionToRoot, BARE_IMMERSION, DEFAULT_IMMERSION, fetchMasterImmersion } from "@/lib/immersion";

interface CyberLayoutProps {
  children: React.ReactNode;
}

const CyberLayout: React.FC<CyberLayoutProps> = ({ children }) => {
  useEffect(() => {
    if (document.documentElement.dataset.cyberTheme === BARE_THEME_ID) {
      applyImmersionToRoot(BARE_IMMERSION);
      return;
    }
    fetchMasterImmersion()
      .then(applyImmersionToRoot)
      .catch(() => applyImmersionToRoot(DEFAULT_IMMERSION));
  }, []);

  return (
    <div className="relative min-h-dvh cyber-gradient overflow-hidden immersion-screen-host">
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

      {/* Terminal top bar — padded for iOS safe area (notch/Dynamic Island). No backdrop-blur (very expensive on mobile GPU). */}
      <div
        className="cyber-terminal-bar fixed top-0 left-0 right-0 z-30 bg-card/95 border-b border-primary/20 flex items-end px-4 gap-3"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', height: 'calc(env(safe-area-inset-top, 0px) + 28px)' }}
      >
        <div className="flex items-center gap-1.5 pb-1">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-neon-yellow/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-primary/70" />
        </div>
        <div className="font-mono-share text-[10px] text-muted-foreground/50 flex-1 text-center pb-1">
          grok@xai:~/neural-render — bash
        </div>
        <div className="font-mono-share text-[10px] text-muted-foreground/30 pb-1">
          PID:4F7A
        </div>
      </div>

      {/* Horizontal scan line — desktop only (animation + layer cost) */}
      <div
        className="cyber-hud-scanline fixed left-0 right-0 h-[1px] z-[15] opacity-20 pointer-events-none hidden md:block"
        style={{
          background: "linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)",
          animation: "hud-scan 8s linear infinite",
        }}
      />

      {/* HUD overlay */}
      <HudOverlay />

      {/* Main content — offset by terminal bar height + safe area */}
      <div
        className="cyber-main-padding relative z-20"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)' }}
      >{children}</div>
    </div>
  );
};

export default CyberLayout;

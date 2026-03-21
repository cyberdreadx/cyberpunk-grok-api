import React, { useEffect } from "react";
import DataRain from "@/components/DataRain";
import HudOverlay from "@/components/HudOverlay";
import { getStoredThemeId, getThemeById, applyTheme } from "@/lib/themes";
import { applyImmersionToRoot, DEFAULT_IMMERSION, fetchMasterImmersion } from "@/lib/immersion";

interface CyberLayoutProps {
  children: React.ReactNode;
}

const CyberLayout: React.FC<CyberLayoutProps> = ({ children }) => {
  useEffect(() => {
    applyTheme(getThemeById(getStoredThemeId()));
    fetchMasterImmersion()
      .then(applyImmersionToRoot)
      .catch(() => applyImmersionToRoot(DEFAULT_IMMERSION));
  }, []);

  return (
    <div className="relative min-h-screen cyber-gradient overflow-hidden noise-overlay immersion-screen-host">
      {/* Global immersion pulse (Hz + flicker depth) — full screen, visible above page content */}
      <div
        className="fixed inset-0 z-[25] pointer-events-none immersion-flicker immersion-pulse-layer"
        aria-hidden
      />

      {/* CRT scanline overlay — opacity driven by --immersion-scanline */}
      <div className="fixed inset-0 scanline z-10 pointer-events-none" />

      {/* Vignette edges — strength driven by --immersion-vignette */}
      <div className="fixed inset-0 z-10 pointer-events-none immersion-vignette" />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.03] z-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--primary)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Corner frame decorations */}
      <div className="fixed top-0 left-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-primary/40 to-transparent" />
        <div className="absolute top-0 left-0 h-full w-[1px] bg-gradient-to-b from-primary/40 to-transparent" />
      </div>
      <div className="fixed top-0 right-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute top-0 right-0 w-full h-[1px] bg-gradient-to-l from-primary/40 to-transparent" />
        <div className="absolute top-0 right-0 h-full w-[1px] bg-gradient-to-b from-primary/40 to-transparent" />
      </div>
      <div className="fixed bottom-0 left-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-primary/40 to-transparent" />
        <div className="absolute bottom-0 left-0 h-full w-[1px] bg-gradient-to-t from-primary/40 to-transparent" />
      </div>
      <div className="fixed bottom-0 right-0 w-16 h-16 z-10 pointer-events-none hidden md:block">
        <div className="absolute bottom-0 right-0 w-full h-[1px] bg-gradient-to-l from-primary/40 to-transparent" />
        <div className="absolute bottom-0 right-0 h-full w-[1px] bg-gradient-to-t from-primary/40 to-transparent" />
      </div>

      {/* Data rain */}
      <DataRain intensity={25} />

      {/* Terminal top bar */}
      <div className="fixed top-0 left-0 right-0 z-30 h-7 bg-card/90 backdrop-blur-sm border-b border-primary/20 flex items-center px-4 gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-neon-yellow/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-primary/70" />
        </div>
        <div className="font-mono-share text-[10px] text-muted-foreground/50 flex-1 text-center">
          grok@xai:~/neural-render — bash
        </div>
        <div className="font-mono-share text-[10px] text-muted-foreground/30">
          PID:4F7A
        </div>
      </div>

      {/* Horizontal scan line */}
      <div
        className="fixed left-0 right-0 h-[1px] z-[15] opacity-20 pointer-events-none"
        style={{
          background: "linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)",
          animation: "hud-scan 8s linear infinite",
        }}
      />

      {/* HUD overlay */}
      <HudOverlay />

      {/* Main content */}
      <div className="relative z-20 pt-7">{children}</div>
    </div>
  );
};

export default CyberLayout;

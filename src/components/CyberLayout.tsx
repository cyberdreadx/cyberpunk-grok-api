import React from "react";
import DataRain from "@/components/DataRain";
import HudOverlay from "@/components/HudOverlay";

interface CyberLayoutProps {
  children: React.ReactNode;
}

const CyberLayout: React.FC<CyberLayoutProps> = ({ children }) => {
  return (
    <div className="relative min-h-screen cyber-gradient overflow-hidden">
      {/* Scanline overlay */}
      <div className="fixed inset-0 scanline z-10" />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.04] z-0"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--neon-cyan)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--neon-cyan)) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Data rain */}
      <DataRain intensity={25} />

      {/* Terminal top bar */}
      <div className="fixed top-0 left-0 right-0 z-30 h-7 bg-card/80 backdrop-blur-sm border-b border-border flex items-center px-4 gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-neon-red/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-neon-yellow/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-primary/70" />
        </div>
        <div className="font-mono-share text-[10px] text-muted-foreground/50 flex-1 text-center">
          grok@xai:~/neural-render — bash
        </div>
        <div className="font-mono-share text-[10px] text-muted-foreground/30">
          ⌘
        </div>
      </div>

      {/* Horizontal scan line */}
      <div
        className="fixed left-0 right-0 h-[1px] z-[15] opacity-20"
        style={{
          background: "linear-gradient(90deg, transparent, hsl(180 100% 50%), transparent)",
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

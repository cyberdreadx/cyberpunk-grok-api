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

      {/* Corner accents with animated borders */}
      <div className="fixed top-0 left-0 w-40 h-40 border-l-2 border-t-2 border-primary/30 z-20">
        <div className="absolute top-0 left-0 w-3 h-3 bg-primary/50 animate-pulse-glow" />
      </div>
      <div className="fixed top-0 right-0 w-40 h-40 border-r-2 border-t-2 border-secondary/30 z-20">
        <div className="absolute top-0 right-0 w-3 h-3 bg-secondary/50 animate-pulse-glow" />
      </div>
      <div className="fixed bottom-0 left-0 w-40 h-40 border-l-2 border-b-2 border-secondary/30 z-20">
        <div className="absolute bottom-0 left-0 w-3 h-3 bg-secondary/50 animate-pulse-glow" />
      </div>
      <div className="fixed bottom-0 right-0 w-40 h-40 border-r-2 border-b-2 border-primary/30 z-20">
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-primary/50 animate-pulse-glow" />
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
      <div className="relative z-20">{children}</div>
    </div>
  );
};

export default CyberLayout;

import React, { forwardRef, lazy, Suspense } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

// Lazy-load the WebGL orb so Three.js is never downloaded on mobile
const GrokOrbWebGL = lazy(() => import("./GrokOrbWebGL"));

/**
 * Lightweight CSS-only orb for mobile — zero WebGL, zero GPU.
 */
const CSSOrb: React.FC<{ isGenerating: boolean }> = ({ isGenerating }) => (
  <div className="relative w-full h-full flex items-center justify-center">
    <div
      className={`absolute rounded-full transition-transform duration-1000 ${
        isGenerating ? "scale-110" : "scale-100"
      }`}
      style={{
        width: "80%",
        height: "80%",
        background: isGenerating
          ? "radial-gradient(circle, hsl(var(--secondary) / 0.35), hsl(var(--primary) / 0.15), transparent 70%)"
          : "radial-gradient(circle, hsl(var(--primary) / 0.25), transparent 70%)",
        filter: "blur(20px)",
        animation: isGenerating ? "cssorb-pulse 2s ease-in-out infinite" : undefined,
      }}
    />
    <div
      className="relative rounded-full"
      style={{
        width: "55%",
        height: "55%",
        background: isGenerating
          ? "radial-gradient(circle at 35% 35%, hsl(var(--primary)), hsl(270 80% 55%) 60%, hsl(300 100% 40%) 100%)"
          : "radial-gradient(circle at 35% 35%, hsl(180 100% 65%), hsl(200 80% 40%) 70%, hsl(220 60% 25%) 100%)",
        boxShadow: isGenerating
          ? "0 0 30px hsl(var(--secondary) / 0.5), 0 0 60px hsl(var(--primary) / 0.25), inset 0 0 20px hsl(var(--primary) / 0.3)"
          : "0 0 20px hsl(var(--primary) / 0.3), inset 0 0 15px hsl(var(--primary) / 0.2)",
        animation: isGenerating ? "cssorb-spin 4s linear infinite" : "cssorb-spin 12s linear infinite",
      }}
    >
      <div
        className="absolute rounded-full"
        style={{
          top: "15%",
          left: "20%",
          width: "30%",
          height: "25%",
          background: "radial-gradient(ellipse, hsl(180 100% 95% / 0.6), transparent)",
          filter: "blur(4px)",
        }}
      />
    </div>
    <div
      className="absolute rounded-full border"
      style={{
        width: "72%",
        height: "72%",
        borderColor: isGenerating ? "hsl(var(--primary) / 0.6)" : "hsl(var(--primary) / 0.25)",
        animation: isGenerating ? "cssorb-ring 3s linear infinite" : "cssorb-ring 8s linear infinite",
        transform: "rotateX(65deg)",
      }}
    />
    <div
      className="absolute rounded-full border"
      style={{
        width: "85%",
        height: "85%",
        borderColor: isGenerating ? "hsl(270 80% 60% / 0.45)" : "hsl(270 80% 60% / 0.15)",
        animation: isGenerating ? "cssorb-ring 5s linear infinite reverse" : "cssorb-ring 14s linear infinite reverse",
        transform: "rotateX(55deg) rotateY(20deg)",
      }}
    />
  </div>
);

interface GrokOrbProps {
  isGenerating: boolean;
  className?: string;
}

const GrokOrb = forwardRef<HTMLDivElement, GrokOrbProps>(({ isGenerating, className = "" }, ref) => {
  const isMobile = useIsMobile();

  return (
    <div ref={ref} className={`relative ${className}`}>
      {isMobile ? (
        <CSSOrb isGenerating={isGenerating} />
      ) : (
        <Suspense fallback={<CSSOrb isGenerating={isGenerating} />}>
          <GrokOrbWebGL isGenerating={isGenerating} />
        </Suspense>
      )}

      <div className="absolute bottom-2 left-0 right-0 text-center">
        <span
          className={`font-mono-share text-[9px] tracking-widest transition-all duration-500 ${
            isGenerating ? "neon-text-magenta animate-flicker" : "text-muted-foreground/40"
          }`}
        >
          {isGenerating ? "◉ NEURAL_PROCESSING" : "◎ GLTCH_STANDBY"}
        </span>
      </div>
    </div>
  );
});

GrokOrb.displayName = "GrokOrb";
export default GrokOrb;

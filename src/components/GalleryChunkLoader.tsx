import React from "react";

/**
 * Shown while the lazy `ResultsGrid` chunk loads (first visit / slow network).
 * Matches OUTPUT_STREAM / ResultsGrid loading aesthetics (CSS-only, compositor rings).
 */
const GalleryChunkLoader: React.FC = () => {
  return (
    <div
      className="border border-primary/30 rounded-lg p-1 animate-in fade-in duration-300"
      aria-busy
      aria-label="Loading gallery module"
    >
      <div className="loader-scanlines bg-muted rounded flex flex-col items-center justify-center gap-4 py-12 sm:py-16 relative overflow-hidden min-h-[200px]">
        <div
          className="loader-scanline absolute inset-x-0 top-0 h-[2px] pointer-events-none"
          style={{ background: "hsl(180 100% 50% / 0.7)" }}
        />

        <div className="relative flex items-center justify-center w-20 h-20">
          <svg className="absolute inset-0 w-full h-full loader-ring-spin" viewBox="0 0 80 80" fill="none">
            <circle cx="40" cy="40" r="36" stroke="hsl(180 100% 50% / 0.15)" strokeWidth="2" />
            <circle
              cx="40"
              cy="40"
              r="36"
              stroke="hsl(180 100% 50%)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="60 166"
              style={{ filter: "drop-shadow(0 0 4px hsl(180 100% 50% / 0.8))" }}
            />
          </svg>
          <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] loader-ring-counter" viewBox="0 0 48 48" fill="none">
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="hsl(180 100% 50% / 0.35)"
              strokeWidth="1"
              strokeLinecap="round"
              strokeDasharray="20 106"
            />
          </svg>
          <div className="w-2 h-2 rounded-full loader-dot-pulse bg-primary" />
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center px-4">
          <span className="font-orbitron text-[10px] tracking-widest text-primary">LOADING_OUTPUT_MODULE</span>
          <span className="font-mono-share text-[10px] text-primary/60">Bundling gallery and asset pipeline…</span>
        </div>
      </div>
    </div>
  );
};

export default GalleryChunkLoader;

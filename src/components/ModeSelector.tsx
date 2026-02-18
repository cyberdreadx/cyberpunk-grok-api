import React from "react";
import { Image, Pencil, Video, Film, Scissors } from "lucide-react";
import type { GrokMode } from "@/hooks/useGrokApi";

interface ModeSelectorProps {
  activeMode: GrokMode;
  onModeChange: (mode: GrokMode) => void;
}

const modes: { id: GrokMode; label: string; icon: React.ElementType; description: string }[] = [
  { id: "text-to-image", label: "GENERATE", icon: Image, description: "Text → Image" },
  { id: "edit-image", label: "MODIFY", icon: Pencil, description: "Image Edit" },
  { id: "text-to-video", label: "RENDER", icon: Video, description: "Text → Video" },
  { id: "image-to-video", label: "ANIMATE", icon: Film, description: "Image → Video" },
  { id: "edit-video", label: "REMIX", icon: Scissors, description: "Video Edit" },
];

const ModeSelector: React.FC<ModeSelectorProps> = ({ activeMode, onModeChange }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {modes.map((mode) => {
        const isActive = activeMode === mode.id;
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            className={`
              relative group p-4 border rounded transition-all duration-300 text-left
              ${isActive
                ? "border-primary neon-border bg-primary/5"
                : "border-border hover:border-primary/50 bg-card/50 hover:bg-card"
              }
            `}
          >
            {/* Active indicator — terminal cursor style */}
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary animate-pulse-glow" />
            )}

            <div className="flex items-center gap-2 mb-2">
              <span className={`font-mono-share text-[10px] ${isActive ? "text-primary/60" : "text-muted-foreground/30"}`}>
                {isActive ? "❯" : "$"}
              </span>
              <Icon
                className={`w-4 h-4 transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary/70"
                }`}
              />
            </div>
            <div
              className={`font-orbitron text-xs font-bold tracking-wider ${
                isActive ? "neon-text-cyan" : "text-foreground"
              }`}
            >
              {mode.label}
            </div>
            <div className="font-mono-share text-[10px] text-muted-foreground mt-1">
              {mode.description}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default ModeSelector;

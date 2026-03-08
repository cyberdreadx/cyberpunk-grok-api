import React from "react";
import { Image, Pencil, Video, Film, Scissors, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { GrokMode } from "@/hooks/useGrokApi";

interface ModeSelectorProps {
  activeMode: GrokMode;
  onModeChange: (mode: GrokMode) => void;
  isAuthenticated?: boolean;
}

const modes: { id: GrokMode; label: string; icon: React.ElementType; description: string }[] = [
  { id: "text-to-image", label: "GENERATE", icon: Image, description: "Text → Image" },
  { id: "edit-image", label: "MODIFY", icon: Pencil, description: "Image Edit" },
  { id: "text-to-video", label: "RENDER", icon: Video, description: "Text → Video" },
  { id: "image-to-video", label: "ANIMATE", icon: Film, description: "Image → Video" },
  { id: "edit-video", label: "REMIX", icon: Scissors, description: "Video Edit" },
];

const ModeSelector: React.FC<ModeSelectorProps> = ({ activeMode, onModeChange, isAuthenticated }) => {
  return (
    <>
      {/* ── Mobile: horizontal scroll pills ── */}
      <div className="flex sm:hidden gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {modes.map((mode) => {
          const isActive = activeMode === mode.id;
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              onClick={() => onModeChange(mode.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded-full border whitespace-nowrap transition-all duration-200 shrink-0
                ${isActive
                  ? "border-primary bg-primary/15 shadow-[0_0_8px_rgba(var(--primary-rgb),0.2)]"
                  : "border-border/60 bg-card/50 active:bg-card"
                }
              `}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? "text-primary" : "text-muted-foreground/60"}`} />
              <span className={`font-orbitron text-[9px] tracking-wider ${isActive ? "text-primary" : "text-foreground/70"}`}>
                {mode.label}
              </span>
            </button>
          );
        })}
        {isAuthenticated && (
          <a
            href="/characters"
            className="flex items-center gap-1.5 px-3 py-2 rounded-full border whitespace-nowrap transition-all duration-200 shrink-0 border-purple-500/40 bg-card/50 active:bg-purple-500/10"
          >
            <Users className={`w-3.5 h-3.5 text-purple-400/70`} />
            <span className="font-orbitron text-[9px] tracking-wider text-purple-400/80">CHARS</span>
          </a>
        )}
      </div>

      {/* ── Desktop: card grid ── */}
      <div className="hidden sm:grid grid-cols-3 lg:grid-cols-6 gap-3">
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

        {isAuthenticated && (
          <Link
            to="/characters"
            className="relative group p-4 border rounded transition-all duration-300 text-left border-border hover:border-purple-500/50 bg-card/50 hover:bg-card"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono-share text-[10px] text-muted-foreground/30">$</span>
              <Users className="w-4 h-4 transition-colors text-muted-foreground group-hover:text-purple-400" />
            </div>
            <div className="font-orbitron text-xs font-bold tracking-wider text-foreground group-hover:text-purple-400 transition-colors">
              CHARACTERS
            </div>
            <div className="font-mono-share text-[10px] text-muted-foreground mt-1">
              AI Chat
            </div>
          </Link>
        )}
      </div>
    </>
  );
};

export default ModeSelector;

import React from "react";
import { Image, Pencil, Video, Film, Scissors, Users, TerminalSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GrokMode } from "@/hooks/useGrokApi";

interface ModeSelectorProps {
  activeMode: GrokMode;
  onModeChange: (mode: GrokMode) => void;
  isAuthenticated?: boolean;
}

const modes: { id: GrokMode; labelKey: string; icon: React.ElementType; descKey: string; shortcut: string }[] = [
  { id: "text-to-image", labelKey: "modes.generate", icon: Image, descKey: "modes.descGenerate", shortcut: "01" },
  { id: "edit-image", labelKey: "modes.modify", icon: Pencil, descKey: "modes.descModify", shortcut: "02" },
  { id: "text-to-video", labelKey: "modes.render", icon: Video, descKey: "modes.descRender", shortcut: "03" },
  { id: "image-to-video", labelKey: "modes.animate", icon: Film, descKey: "modes.descAnimate", shortcut: "04" },
  { id: "edit-video", labelKey: "modes.remix", icon: Scissors, descKey: "modes.descRemix", shortcut: "05" },
];

const ModeSelector: React.FC<ModeSelectorProps> = ({ activeMode, onModeChange, isAuthenticated }) => {
  const { t } = useTranslation();
  return (
    <>
      {/* Mobile: horizontal scroll pills */}
      <div className="flex sm:hidden gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {modes.map((mode) => {
          const isActive = activeMode === mode.id;
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              onClick={() => onModeChange(mode.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded border whitespace-nowrap transition-all duration-200 shrink-0
                ${isActive
                  ? "border-primary/50 bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.15)]"
                  : "border-border/40 bg-card/50 active:bg-card"
                }
              `}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? "text-primary" : "text-muted-foreground/60"}`} />
              <span className={`font-orbitron text-[9px] tracking-wider ${isActive ? "text-primary" : "text-foreground/70"}`}>
                {t(mode.labelKey)}
              </span>
            </button>
          );
        })}
        {isAuthenticated && (
          <a
            href="/characters"
            className="flex items-center gap-1.5 px-3 py-2 rounded border whitespace-nowrap transition-all duration-200 shrink-0 border-secondary/30 bg-card/50 active:bg-secondary/10"
          >
            <Users className="w-3.5 h-3.5 text-secondary/70" />
            <span className="font-orbitron text-[9px] tracking-wider text-secondary/80">{t("modes.chars")}</span>
          </a>
        )}
        <Link
          to="/terminal"
          className="flex items-center gap-1.5 px-3 py-2 rounded border whitespace-nowrap transition-all duration-200 shrink-0 border-primary/40 bg-black/60 active:bg-primary/10"
          title="Hacker terminal mode"
        >
          <TerminalSquare className="w-3.5 h-3.5 text-primary" />
          <span className="font-orbitron text-[9px] tracking-wider text-primary">TERMINAL</span>
        </Link>
      </div>

      {/* Desktop: terminal-style grid */}
      <div className="hidden sm:grid grid-cols-3 lg:grid-cols-6 gap-2">
        {modes.map((mode) => {
          const isActive = activeMode === mode.id;
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              onClick={() => onModeChange(mode.id)}
              className={`
                relative group p-3 border rounded transition-all duration-300 text-left overflow-hidden
                ${isActive
                  ? "border-primary/50 bg-primary/5 shadow-[0_0_15px_hsl(var(--primary)/0.1)]"
                  : "border-border/40 hover:border-primary/30 bg-card/30 hover:bg-card/60"
                }
              `}
            >
              {/* Top accent line */}
              <div
                className={`absolute top-0 left-0 right-0 h-[2px] transition-all duration-300 ${
                  isActive ? "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]" : "bg-transparent group-hover:bg-primary/30"
                }`}
              />

              {/* Index number */}
              <span className={`absolute top-2 right-2 font-mono-share text-[8px] ${isActive ? "text-primary/40" : "text-muted-foreground/15"}`}>
                {mode.shortcut}
              </span>

              <div className="flex items-center gap-2 mb-1.5">
                <span className={`font-mono-share text-[10px] ${isActive ? "text-primary/60" : "text-muted-foreground/20"}`}>
                  {isActive ? "▸" : "$"}
                </span>
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground/50 group-hover:text-primary/60"
                  }`}
                />
              </div>
              <div
                className={`font-orbitron text-[10px] font-bold tracking-wider ${
                  isActive ? "neon-text-cyan" : "text-foreground/80"
                }`}
              >
                {t(mode.labelKey)}
              </div>
              <div className="font-mono-share text-[9px] text-muted-foreground/40 mt-0.5">
                {t(mode.descKey)}
              </div>
            </button>
          );
        })}

        {isAuthenticated && (
          <Link
            to="/characters"
            className="relative group p-3 border rounded transition-all duration-300 text-left overflow-hidden border-border/40 hover:border-secondary/30 bg-card/30 hover:bg-card/60"
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-transparent group-hover:bg-secondary/30 transition-all" />
            <span className="absolute top-2 right-2 font-mono-share text-[8px] text-muted-foreground/15">06</span>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono-share text-[10px] text-muted-foreground/20">$</span>
              <Users className="w-4 h-4 transition-colors text-muted-foreground/50 group-hover:text-secondary/70" />
            </div>
            <div className="font-orbitron text-[10px] font-bold tracking-wider text-foreground/80 group-hover:text-secondary transition-colors">
              {t("modes.characters")}
            </div>
            <div className="font-mono-share text-[9px] text-muted-foreground/40 mt-0.5">
              {t("modes.descCharacters")}
            </div>
          </Link>
        )}
      </div>
    </>
  );
};

export default ModeSelector;

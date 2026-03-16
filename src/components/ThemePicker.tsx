import React, { useState, useEffect, useCallback } from "react";
import { THEMES, getStoredThemeId, getThemeById, applyTheme, type CyberTheme } from "@/lib/themes";
import { Palette } from "lucide-react";

const ThemePicker: React.FC = () => {
  const [activeId, setActiveId] = useState(getStoredThemeId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    applyTheme(getThemeById(activeId));
  }, []);

  const select = useCallback((theme: CyberTheme) => {
    applyTheme(theme);
    setActiveId(theme.id);
    setOpen(false);
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 px-2 py-1 font-mono-share text-[10px] text-muted-foreground/60 hover:text-primary transition-colors border border-border/30 rounded bg-card/40 hover:bg-card/80"
        title="Switch theme"
      >
        <Palette className="w-3 h-3" />
        <span className="hidden sm:inline">{getThemeById(activeId).name}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-card/95 backdrop-blur-md border border-border rounded-md shadow-[0_0_30px_rgba(var(--primary-rgb,0,255,255),0.15)] overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50">
              <span className="font-mono-share text-[9px] text-muted-foreground/50">$ select --theme</span>
            </div>
            {THEMES.map((theme) => {
              const isActive = theme.id === activeId;
              return (
                <button
                  key={theme.id}
                  onClick={() => select(theme)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/30 text-foreground/80"
                  }`}
                >
                  <div
                    className="w-4 h-4 rounded-full border-2 shrink-0 transition-shadow"
                    style={{
                      backgroundColor: theme.swatch,
                      borderColor: isActive ? theme.swatch : "transparent",
                      boxShadow: isActive ? `0 0 8px ${theme.swatch}80` : "none",
                    }}
                  />
                  <div className="min-w-0">
                    <div className="font-orbitron text-[10px] tracking-wider truncate">{theme.name}</div>
                    <div className="font-mono-share text-[8px] text-muted-foreground/50 truncate">{theme.label}</div>
                  </div>
                  {isActive && <span className="ml-auto font-mono-share text-[10px] text-primary/60 shrink-0">ACTIVE</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default ThemePicker;

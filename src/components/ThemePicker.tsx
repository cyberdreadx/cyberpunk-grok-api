import React, { useState, useEffect, useCallback } from "react";
import { THEMES, getStoredThemeId, getThemeById, applyTheme, type CyberTheme } from "@/lib/themes";
import { Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

  /* A Radix popover rather than an absolutely positioned list: this sits at the
     bottom of the page inside the "more" menu, where a list that always opened
     downward ran under the mobile bottom nav and off the screen. Radix portals
     it, flips it upward when there is no room below, and keeps it clear of the
     nav bar (collisionPadding). z-[60] puts it over the nav (z-50). */
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
      <button
        className="flex items-center gap-1.5 px-2 py-1 font-mono-share text-tiny text-muted-foreground/60 hover:text-primary transition-colors border border-border/30 rounded bg-card/40 hover:bg-card/80"
        title="Switch theme"
      >
        <Palette className="w-3 h-3" />
        <span className="hidden sm:inline">{getThemeById(activeId).name}</span>
      </button>
      </PopoverTrigger>

          <PopoverContent
            align="end"
            sideOffset={6}
            collisionPadding={{ top: 64, bottom: 80, left: 8, right: 8 }}
            className="z-[60] w-auto min-w-[220px] max-h-[min(70vh,var(--radix-popover-content-available-height))] overflow-y-auto p-0 bg-card/95 backdrop-blur-md border border-border rounded-md shadow-glow-ambient"
          >
            <div className="px-3 py-2 border-b border-border/50">
              <span className="font-mono-share text-tiny text-muted-foreground/70">$ select --theme</span>
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
                    <div className="font-orbitron text-tiny tracking-wider truncate">{theme.name}</div>
                    <div className="font-mono-share text-micro text-muted-foreground/70 truncate">{theme.label}</div>
                  </div>
                  {isActive && <span className="ml-auto font-mono-share text-tiny text-primary/60 shrink-0">Active</span>}
                </button>
              );
            })}
          </PopoverContent>
    </Popover>
  );
};

export default ThemePicker;

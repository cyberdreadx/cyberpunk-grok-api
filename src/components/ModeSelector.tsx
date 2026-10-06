import React from "react";
import { Image, Pencil, Video, Film } from "lucide-react";
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
];

/* Studio's plain names for the same four modes. */
const STUDIO_LABEL: Record<string, string> = {
  "text-to-image": "Image",
  "edit-image": "Edit",
  "text-to-video": "Video",
  "image-to-video": "Animate",
};

const ModeSelector: React.FC<ModeSelectorProps> = ({ activeMode, onModeChange, isAuthenticated }) => {
  const { t } = useTranslation();
  /* Four modes that always fit. Characters and Terminal used to ride along
     here as fake "modes" (a scrolling strip on phones); they live in the More
     menu now. */
  return (
    <div className="grid grid-cols-4 gap-2">
      {modes.map((mode) => {
        const isActive = activeMode === mode.id;
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            aria-pressed={isActive}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-1 py-2.5 sm:py-3 rounded-lg border transition-colors ${isActive
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border/60 bg-card/60 text-foreground/75 hover:border-primary/30"
              }`}
          >
            <Icon className="w-4 h-4" />
            <span className="font-display text-xs sm:text-sm font-semibold">{t(`studioModes.${mode.id}`, STUDIO_LABEL[mode.id])}</span>
          </button>
        );
      })}
    </div>
  );

};

export default ModeSelector;

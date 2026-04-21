import React from "react";
import { Settings, Maximize, Hash, Clock, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  GenerationSettings,
  VideoSettings,
  AspectRatio,
  VideoAspectRatio,
  VideoResolution,
  ImageResolution,
  ImageCount,
  GrokMode,
} from "@/hooks/useGrokApi";
import type { ImmersionSettings } from "@/lib/immersion";
import { DEFAULT_IMMERSION } from "@/lib/immersion";
import ImmersionPulseGuide from "@/components/ImmersionPulseGuide";
import { PULSE_HZ_MAX, PULSE_HZ_MIN } from "@/lib/immersionZones";

export type { ImmersionSettings };
export { DEFAULT_IMMERSION };

interface SettingsPanelProps {
  settings: GenerationSettings;
  videoSettings: VideoSettings;
  immersionSettings?: ImmersionSettings;
  onChange: (settings: GenerationSettings) => void;
  onVideoChange: (settings: VideoSettings) => void;
  onImmersionChange?: (settings: ImmersionSettings) => void;
  isAdmin?: boolean;
  mode: GrokMode;
}

const aspectRatios: { value: AspectRatio; label: string; tag: string }[] = [
  { value: "1:1", label: "1:1", tag: "SQUARE" },
  { value: "16:9", label: "16:9", tag: "WIDE" },
  { value: "9:16", label: "9:16", tag: "TALL" },
  { value: "4:3", label: "4:3", tag: "CLASSIC" },
  { value: "3:4", label: "3:4", tag: "PORTRAIT" },
  { value: "3:2", label: "3:2", tag: "PHOTO" },
  { value: "2:3", label: "2:3", tag: "PHOTO-V" },
  { value: "2:1", label: "2:1", tag: "BANNER" },
  { value: "20:9", label: "20:9", tag: "CINEMA" },
  { value: "9:20", label: "9:20", tag: "CINEMA-V" },
  { value: "19.5:9", label: "19.5:9", tag: "ULTRA-W" },
  { value: "9:19.5", label: "9:19.5", tag: "ULTRA-T" },
  { value: "auto", label: "AUTO", tag: "AUTO" },
];

const videoAspectRatios: { value: VideoAspectRatio; label: string; tag: string }[] = [
  { value: "16:9", label: "16:9", tag: "WIDE" },
  { value: "9:16", label: "9:16", tag: "TALL" },
  { value: "1:1", label: "1:1", tag: "SQUARE" },
  { value: "4:3", label: "4:3", tag: "CLASSIC" },
  { value: "3:4", label: "3:4", tag: "PORTRAIT" },
  { value: "3:2", label: "3:2", tag: "PHOTO" },
  { value: "2:3", label: "2:3", tag: "PHOTO-V" },
];

const videoResolutions: { value: VideoResolution; label: string; desc: string }[] = [
  { value: "720p", label: "720P", desc: "HD" },
  { value: "480p", label: "480P", desc: "SD" },
];

const imageResolutions: { value: ImageResolution; label: string; desc: string }[] = [
  { value: "1k", label: "1K", desc: "Standard" },
  { value: "2k", label: "2K", desc: "High-Res" },
];

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  settings, 
  videoSettings, 
  immersionSettings,
  onChange, 
  onVideoChange, 
  onImmersionChange,
  isAdmin = false,
  mode 
}) => {
  const { t } = useTranslation();
  const isVideoMode = mode === "text-to-video" || mode === "image-to-video";

  const summaryText = isVideoMode
    ? `${videoSettings.aspectRatio} • ${videoSettings.resolution} • ${videoSettings.duration}s`
    : `${settings.aspectRatio} • ×${settings.count} • ${(settings.resolution || "1k").toUpperCase()}`;

  return (
    <Collapsible defaultOpen={false} className="terminal-block rounded-md overflow-hidden px-3 py-2">
      <CollapsibleTrigger className="flex items-center gap-2 w-full group">
        <span className="font-mono-share text-primary/40 text-xs group-data-[state=open]:text-primary/60">▸</span>
        <Settings className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary" />
        <span className="font-mono-share text-[10px] tracking-widest text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary">
          render_config
        </span>
        <div className="h-px flex-1 bg-primary/10" />
        <span className="font-mono-share text-[9px] text-muted-foreground/30">
          {summaryText}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-4 space-y-5 animate-slide-up">
        {isVideoMode ? (
          <>
            {/* Video Aspect Ratio */}
            <div className="space-y-2">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Maximize className="w-3 h-3" />
                ASPECT_RATIO
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {videoAspectRatios.map((ar) => (
                  <button
                    key={ar.value}
                    type="button"
                    onClick={() => onVideoChange({ ...videoSettings, aspectRatio: ar.value })}
                    className={`
                      p-2.5 border rounded text-center transition-all duration-200
                      ${videoSettings.aspectRatio === ar.value
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-mono-share text-xs ${videoSettings.aspectRatio === ar.value ? "text-primary" : "text-foreground"}`}>
                      {ar.label}
                    </div>
                    <div className="font-orbitron text-[8px] text-muted-foreground mt-0.5">
                      {ar.tag}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Video Resolution */}
            <div className="space-y-2">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Monitor className="w-3 h-3" />
                RESOLUTION
              </label>
              <div className="grid grid-cols-2 gap-2">
                {videoResolutions.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => onVideoChange({ ...videoSettings, resolution: r.value })}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${videoSettings.resolution === r.value
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-xs ${videoSettings.resolution === r.value ? "text-primary" : "text-foreground"}`}>
                      {r.label}
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5">
                      {r.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Video Duration */}
            <div className="space-y-2">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                DURATION
                <span className="font-mono-share text-[9px] text-muted-foreground/50 ml-auto">
                  {videoSettings.duration}s
                </span>
              </label>
              <div className="flex items-center gap-3">
                <span className="font-mono-share text-[9px] text-muted-foreground">1s</span>
                <input
                  type="range"
                  min={1}
                  max={15}
                  step={1}
                  value={videoSettings.duration}
                  onChange={(e) => onVideoChange({ ...videoSettings, duration: Number(e.target.value) })}
                  className="flex-1 accent-[hsl(var(--primary))] h-1 bg-border rounded-full cursor-pointer"
                />
                <span className="font-mono-share text-[9px] text-muted-foreground">15s</span>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Image Aspect Ratio */}
            <div className="space-y-2">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Maximize className="w-3 h-3" />
                ASPECT_RATIO
              </label>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {aspectRatios.map((ar) => (
                  <button
                    key={ar.value}
                    type="button"
                    onClick={() => onChange({ ...settings, aspectRatio: ar.value })}
                    className={`
                      p-2 border rounded text-center transition-all duration-200
                      ${settings.aspectRatio === ar.value
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-mono-share text-[10px] ${settings.aspectRatio === ar.value ? "text-primary" : "text-foreground"}`}>
                      {ar.label}
                    </div>
                    <div className="font-orbitron text-[7px] text-muted-foreground mt-0.5">
                      {ar.tag}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Image Resolution */}
            <div className="space-y-2">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Monitor className="w-3 h-3" />
                RESOLUTION
              </label>
              <div className="grid grid-cols-2 gap-2">
                {imageResolutions.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => onChange({ ...settings, resolution: r.value })}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${(settings.resolution || "1k") === r.value
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-xs ${(settings.resolution || "1k") === r.value ? "text-primary" : "text-foreground"}`}>
                      {r.label}
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5">
                      {r.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Image Count */}
            <div className="space-y-2">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Hash className="w-3 h-3" />
                BATCH_COUNT
                <span className="font-mono-share text-[9px] text-muted-foreground/50 ml-auto">
                  ×{settings.count}
                </span>
              </label>
              <div className="flex items-center gap-3">
                <span className="font-mono-share text-[9px] text-muted-foreground">1</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={settings.count}
                  onChange={(e) => onChange({ ...settings, count: Number(e.target.value) as ImageCount })}
                  className="flex-1 accent-[hsl(var(--primary))] h-1 bg-border rounded-full cursor-pointer"
                />
                <span className="font-mono-share text-[9px] text-muted-foreground">10</span>
              </div>
            </div>

          </>
        )}

      </CollapsibleContent>
    </Collapsible>
  );
};

export default SettingsPanel;

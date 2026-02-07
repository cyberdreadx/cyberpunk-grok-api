import React from "react";
import { Settings, Maximize, Hash, FileImage, Clock, Monitor } from "lucide-react";
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
  ImageFormat,
  ImageCount,
  GrokMode,
} from "@/hooks/useGrokApi";

interface SettingsPanelProps {
  settings: GenerationSettings;
  videoSettings: VideoSettings;
  onChange: (settings: GenerationSettings) => void;
  onVideoChange: (settings: VideoSettings) => void;
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

const counts: ImageCount[] = [1, 2, 3, 4];

const formats: { value: ImageFormat; label: string; desc: string }[] = [
  { value: "url", label: "URL", desc: "Hosted link" },
  { value: "base64", label: "BASE64", desc: "Embedded data" },
];

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, videoSettings, onChange, onVideoChange, mode }) => {
  const isVideoMode = mode === "text-to-video" || mode === "image-to-video";

  const summaryText = isVideoMode
    ? `${videoSettings.aspectRatio} • ${videoSettings.resolution} • ${videoSettings.duration}s`
    : `${settings.aspectRatio} • ×${settings.count} • ${settings.imageFormat.toUpperCase()}`;

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 w-full group">
        <span className="font-mono-share text-primary/40 text-xs group-data-[state=open]:text-primary/60">❯</span>
        <Settings className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary" />
        <span className="font-mono-share text-[10px] tracking-widest text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary">
          render_config
        </span>
        <div className="h-px flex-1 bg-border/50" />
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {aspectRatios.map((ar) => (
                  <button
                    key={ar.value}
                    type="button"
                    onClick={() => onChange({ ...settings, aspectRatio: ar.value })}
                    className={`
                      p-2.5 border rounded text-center transition-all duration-200
                      ${settings.aspectRatio === ar.value
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-mono-share text-xs ${settings.aspectRatio === ar.value ? "text-primary" : "text-foreground"}`}>
                      {ar.label}
                    </div>
                    <div className="font-orbitron text-[8px] text-muted-foreground mt-0.5">
                      {ar.tag}
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
              </label>
              <div className="flex gap-2">
                {counts.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onChange({ ...settings, count: c })}
                    className={`
                      flex-1 py-2 border rounded font-mono-share text-sm transition-all duration-200
                      ${settings.count === c
                        ? "border-primary neon-border bg-primary/5 text-primary"
                        : "border-border bg-card/30 text-foreground hover:border-primary/40"
                      }
                    `}
                  >
                    ×{c}
                  </button>
                ))}
              </div>
            </div>

            {/* Output Format */}
            <div className="space-y-2">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileImage className="w-3 h-3" />
                OUTPUT_FORMAT
              </label>
              <div className="grid grid-cols-2 gap-2">
                {formats.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => onChange({ ...settings, imageFormat: f.value })}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${settings.imageFormat === f.value
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-xs ${settings.imageFormat === f.value ? "text-primary" : "text-foreground"}`}>
                      {f.label}
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5">
                      {f.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SettingsPanel;

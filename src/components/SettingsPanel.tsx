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
  const { t, i18n } = useTranslation();
  const { matureFilter, setMatureFilter } = useMatureFilter();
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

        {/* Language Selector */}
        <div className="space-y-2">
          <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Globe className="w-3 h-3" />
            {t("settings.language").toUpperCase()}
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => i18n.changeLanguage(lang.code)}
                className={`
                  p-2 border rounded text-center transition-all duration-200
                  ${i18n.language?.startsWith(lang.code)
                    ? "border-primary neon-border bg-primary/5"
                    : "border-border bg-card/30 hover:border-primary/40"
                  }
                `}
              >
                <div className={`text-sm ${i18n.language?.startsWith(lang.code) ? "text-primary" : "text-foreground"}`}>
                  {lang.flag} {lang.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ADMIN ONLY - Immersion Control */}
        {isAdmin && onImmersionChange && (
          <div className="pt-6 border-t border-red-500/20 mt-6">
            <label className="font-orbitron text-[10px] tracking-wider text-red-400 flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4" />
              IMMERSION CONTROL
              <span className="text-[9px] text-red-500/50 font-mono-share">(GLOBAL — ALL USERS)</span>
            </label>
            <p className="font-mono-share text-[8px] text-muted-foreground/70 mb-3 leading-relaxed">
              Saves to the server. Everyone loads these values; sliders debounce ~650ms before POST.
            </p>

            <div className="space-y-5">
              <div>
                <div className="flex justify-between text-[10px] mb-1 text-muted-foreground gap-2">
                  <span>FLICKER DEPTH (0–1)</span>
                  <span className="font-mono-share text-red-400 shrink-0">{(immersionSettings?.flicker ?? 0.35).toFixed(3)}</span>
                </div>
                <p className="text-[8px] text-muted-foreground/65 mb-1.5 leading-relaxed">
                  <span className="text-amber-500/80 font-mono-share">Not Hz.</span> Amplitude of the opacity/brightness swing in the flicker keyframes. Higher + faster pulse → stronger perceived strobing.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={immersionSettings?.flicker ?? 0.35}
                    onChange={(e) => onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), flicker: parseFloat(e.target.value) })}
                    className="flex-1 min-w-0 accent-red-500"
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={immersionSettings?.flicker ?? 0.35}
                    onChange={(e) => {
                      const v = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
                      onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), flicker: v });
                    }}
                    className="w-[4.5rem] shrink-0 rounded border border-border/50 bg-background/80 px-1.5 py-0.5 font-mono-share text-[10px] text-right"
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap justify-between text-[10px] mb-1 text-muted-foreground gap-2">
                  <span>PULSE RATE (Hz)</span>
                  <span className="font-mono-share text-red-400 shrink-0">
                    {(immersionSettings?.pulseHz ?? 0.7).toFixed(3)} Hz
                  </span>
                </div>
                <ImmersionPulseGuide hz={immersionSettings?.pulseHz ?? 0.7} />
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="range"
                    min={PULSE_HZ_MIN}
                    max={PULSE_HZ_MAX}
                    step="0.05"
                    value={Math.min(PULSE_HZ_MAX, Math.max(PULSE_HZ_MIN, immersionSettings?.pulseHz ?? 0.7))}
                    onChange={(e) => onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), pulseHz: parseFloat(e.target.value) })}
                    className="flex-1 min-w-0 accent-red-500"
                  />
                  <input
                    type="number"
                    min={PULSE_HZ_MIN}
                    max={PULSE_HZ_MAX}
                    step={0.01}
                    value={immersionSettings?.pulseHz ?? 0.7}
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value);
                      if (Number.isNaN(raw)) return;
                      const v = Math.min(PULSE_HZ_MAX, Math.max(PULSE_HZ_MIN, raw));
                      onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), pulseHz: v });
                    }}
                    className="w-[4.75rem] shrink-0 rounded border border-border/50 bg-background/80 px-1.5 py-0.5 font-mono-share text-[10px] text-right"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                  <span>RED SHIFT (hue)</span>
                  <span className="font-mono-share text-red-400">{(immersionSettings?.redShift ?? 8).toFixed(1)}</span>
                </div>
                <p className="text-[8px] text-muted-foreground/65 mb-1.5">
                  Pushes global <span className="font-mono-share text-muted-foreground/80">hue-rotate</span> (not Hz). ~0–30 mapped in CSS filter.
                </p>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="0.5"
                  value={immersionSettings?.redShift ?? 8}
                  onChange={(e) => onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), redShift: parseFloat(e.target.value) })}
                  className="w-full accent-red-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                  <span>GLOW / BRIGHTNESS BIAS</span>
                  <span className="font-mono-share text-red-400">{(immersionSettings?.glow ?? 0.85).toFixed(3)}</span>
                </div>
                <p className="text-[8px] text-muted-foreground/65 mb-1.5">
                  Scales <span className="font-mono-share">brightness()</span> on the immersion filter host (unitless 0–2).
                </p>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={immersionSettings?.glow ?? 0.85}
                  onChange={(e) => onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), glow: parseFloat(e.target.value) })}
                  className="w-full accent-red-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                  <span>SCANLINE WEIGHT</span>
                  <span className="font-mono-share text-red-400">{(immersionSettings?.scanline ?? 0.16).toFixed(3)}</span>
                </div>
                <p className="text-[8px] text-muted-foreground/65 mb-1.5">Line contrast overlay (0–1). Not Hz.</p>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={immersionSettings?.scanline ?? 0.16}
                  onChange={(e) => onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), scanline: parseFloat(e.target.value) })}
                  className="w-full accent-red-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                  <span>VIGNETTE</span>
                  <span className="font-mono-share text-red-400">{(immersionSettings?.vignette ?? 0.4).toFixed(3)}</span>
                </div>
                <p className="text-[8px] text-muted-foreground/65 mb-1.5">Edge darkening strength (0–1). Not Hz.</p>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={immersionSettings?.vignette ?? 0.4}
                  onChange={(e) => onImmersionChange({ ...(immersionSettings ?? DEFAULT_IMMERSION), vignette: parseFloat(e.target.value) })}
                  className="w-full accent-red-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Mature content filter */}
        <div className="space-y-2 pt-2 border-t border-border/30">
          <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
            <EyeOff className="w-3 h-3" />
            MATURE_CONTENT_FILTER
          </label>
          <button
            type="button"
            onClick={() => setMatureFilter(!matureFilter)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-md border transition-colors font-mono-share text-[11px] ${
              matureFilter
                ? "border-amber-400/40 bg-amber-400/5 text-amber-300"
                : "border-border/40 bg-card/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{matureFilter ? "Blur mature posts & stories" : "Mature content filter OFF"}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${matureFilter ? "bg-amber-400/20" : "bg-muted/40"}`}>
              {matureFilter ? "ON" : "OFF"}
            </span>
          </button>
          <p className="font-mono-share text-[9px] text-muted-foreground/60 leading-relaxed">
            When ON, posts and stories the creator marked as mature are blurred until you tap REVEAL.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SettingsPanel;

import React from "react";
import { Settings, Maximize, Hash, FileImage } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { GenerationSettings, ImageSize, ResponseFormat, ImageCount } from "@/hooks/useGrokApi";
import type { GrokMode } from "@/hooks/useGrokApi";

interface SettingsPanelProps {
  settings: GenerationSettings;
  onChange: (settings: GenerationSettings) => void;
  mode: GrokMode;
}

const sizes: { value: ImageSize; label: string; tag: string }[] = [
  { value: "512x512", label: "512²", tag: "SMALL" },
  { value: "1024x1024", label: "1024²", tag: "STD" },
  { value: "1024x1792", label: "1024×1792", tag: "PORTRAIT" },
  { value: "1792x1024", label: "1792×1024", tag: "LANDSCAPE" },
];

const counts: ImageCount[] = [1, 2, 3, 4];

const formats: { value: ResponseFormat; label: string; desc: string }[] = [
  { value: "url", label: "URL", desc: "Hosted link" },
  { value: "b64_json", label: "BASE64", desc: "Embedded data" },
];

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onChange, mode }) => {
  const isVideoMode = mode === "text-to-video" || mode === "image-to-video";

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 w-full group">
        <Settings className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary" />
        <span className="font-orbitron text-[10px] tracking-widest text-muted-foreground group-hover:text-primary transition-colors group-data-[state=open]:text-primary">
          RENDER_CONFIG
        </span>
        <div className="h-px flex-1 bg-border" />
        <span className="font-mono-share text-[9px] text-muted-foreground/50">
          {settings.size} • ×{settings.count} • {settings.responseFormat.toUpperCase()}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-4 space-y-5 animate-slide-up">
        {/* Image Size */}
        {!isVideoMode && (
          <div className="space-y-2">
            <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Maximize className="w-3 h-3" />
              RESOLUTION
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {sizes.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => onChange({ ...settings, size: s.value })}
                  className={`
                    p-2.5 border rounded text-center transition-all duration-200
                    ${settings.size === s.value
                      ? "border-primary neon-border bg-primary/5"
                      : "border-border bg-card/30 hover:border-primary/40"
                    }
                  `}
                >
                  <div className={`font-mono-share text-xs ${settings.size === s.value ? "text-primary" : "text-foreground"}`}>
                    {s.label}
                  </div>
                  <div className="font-orbitron text-[8px] text-muted-foreground mt-0.5">
                    {s.tag}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Image Count */}
        {!isVideoMode && (
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
        )}

        {/* Response Format */}
        {!isVideoMode && (
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
                  onClick={() => onChange({ ...settings, responseFormat: f.value })}
                  className={`
                    p-2.5 border rounded text-left transition-all duration-200
                    ${settings.responseFormat === f.value
                      ? "border-primary neon-border bg-primary/5"
                      : "border-border bg-card/30 hover:border-primary/40"
                    }
                  `}
                >
                  <div className={`font-orbitron text-xs ${settings.responseFormat === f.value ? "text-primary" : "text-foreground"}`}>
                    {f.label}
                  </div>
                  <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5">
                    {f.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {isVideoMode && (
          <div className="border border-border/50 rounded p-3 bg-muted/20">
            <p className="font-mono-share text-[10px] text-muted-foreground">
              ⚡ Video mode uses default API settings. Size, count, and format options are available for image modes only.
            </p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SettingsPanel;

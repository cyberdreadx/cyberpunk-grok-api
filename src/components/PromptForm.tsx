import React, { useState, useEffect } from "react";
import { Send, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { GrokMode, GenerationSettings } from "@/hooks/useGrokApi";

interface PromptFormProps {
  mode: GrokMode;
  isLoading: boolean;
  onSubmit: (data: { prompt: string; imageUrl?: string }) => void;
  settings: GenerationSettings;
  initialPrompt?: string;
}

const PromptForm: React.FC<PromptFormProps> = ({ mode, isLoading, onSubmit, settings, initialPrompt }) => {
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  const needsImage = mode === "edit-image" || mode === "image-to-video";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (needsImage && !imageUrl.trim()) return;
    onSubmit({ prompt: prompt.trim(), imageUrl: imageUrl.trim() || undefined });
  };

  const placeholders: Record<GrokMode, string> = {
    "text-to-image": "Describe the image you want to generate...",
    "edit-image": "Describe the modifications to apply...",
    "text-to-video": "Describe the video scene to render...",
    "image-to-video": "Describe the animation / motion to apply...",
  };

  const isVideoMode = mode === "text-to-video" || mode === "image-to-video";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {needsImage && (
        <div className="space-y-2">
          <label className="font-mono-share text-[10px] tracking-wider text-muted-foreground flex items-center gap-2">
            <span className="text-primary/50">$</span>
            <Upload className="w-3 h-3" />
            source_image_url
          </label>
          <Input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="bg-input border-border font-mono-share text-sm text-foreground placeholder:text-muted-foreground focus:neon-border"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="font-mono-share text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
          <span className="text-primary/50">❯</span>
          prompt
          <span className="inline-block w-1.5 h-3 bg-primary/40 animate-pulse align-middle" />
        </label>
        <div className="relative">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholders[mode]}
            rows={4}
            className="bg-input border-border font-rajdhani text-base text-foreground placeholder:text-muted-foreground focus:neon-border resize-none pr-14"
          />
          <Button
            type="submit"
            disabled={isLoading || !prompt.trim() || (needsImage && !imageUrl.trim())}
            size="icon"
            className="absolute bottom-3 right-3 bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-30 transition-all"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between text-[10px] font-mono-share text-muted-foreground/40 border-t border-border/30 pt-2">
        <span><span className="text-primary/30">mode</span>={mode.toUpperCase().replace(/-/g, "_")}</span>
        {!isVideoMode && (
          <span>{settings.size} • ×{settings.count} • {settings.responseFormat.toUpperCase()}</span>
        )}
        <span>{isLoading ? "⟳ PROCESSING..." : "● READY"}</span>
        <span>{prompt.length} chars</span>
      </div>
    </form>
  );
};

export default PromptForm;

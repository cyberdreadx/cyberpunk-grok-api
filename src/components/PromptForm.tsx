import React, { useState, useEffect, useRef } from "react";
import { Send, Upload, Loader2, ImagePlus, Link, X } from "lucide-react";
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
  initialImageUrl?: string;
}

const PromptForm: React.FC<PromptFormProps> = ({ mode, isLoading, onSubmit, settings, initialPrompt, initialImageUrl }) => {
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [imageUrl, setImageUrl] = useState(initialImageUrl || "");
  const [imageSource, setImageSource] = useState<"url" | "upload">(initialImageUrl ? "url" : "upload");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (initialImageUrl) {
      setImageUrl(initialImageUrl);
      setImageSource("url");
      setUploadPreview(null);
    }
  }, [initialImageUrl]);

  const needsImage = mode === "edit-image" || mode === "image-to-video";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageUrl(dataUrl);
      setUploadPreview(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const clearUpload = () => {
    setImageUrl("");
    setUploadPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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

  const hasImage = imageSource === "upload" ? !!uploadPreview : !!imageUrl.trim();

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {needsImage && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-mono-share text-[10px] tracking-wider text-muted-foreground flex items-center gap-2">
              <span className="text-primary/50">$</span>
              <Upload className="w-3 h-3" />
              source_image
            </label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => { setImageSource("upload"); setImageUrl(""); }}
                className={`font-mono-share text-[9px] px-2 py-0.5 rounded transition-colors ${
                  imageSource === "upload"
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground border border-border/30"
                }`}
              >
                <ImagePlus className="w-3 h-3 inline mr-1" />
                UPLOAD
              </button>
              <button
                type="button"
                onClick={() => { setImageSource("url"); clearUpload(); }}
                className={`font-mono-share text-[9px] px-2 py-0.5 rounded transition-colors ${
                  imageSource === "url"
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground border border-border/30"
                }`}
              >
                <Link className="w-3 h-3 inline mr-1" />
                URL
              </button>
            </div>
          </div>

          {imageSource === "upload" ? (
            <div className="relative">
              {uploadPreview ? (
                <div className="relative group">
                  <img
                    src={uploadPreview}
                    alt="Upload preview"
                    className="w-full max-h-32 object-contain rounded border border-border bg-input"
                  />
                  <button
                    type="button"
                    onClick={clearUpload}
                    className="absolute top-1 right-1 p-1 rounded bg-background/80 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-20 border border-dashed border-border rounded flex flex-col items-center justify-center gap-1 bg-input/50 hover:bg-input hover:border-primary/30 transition-colors cursor-pointer"
                >
                  <ImagePlus className="w-5 h-5 text-muted-foreground" />
                  <span className="font-mono-share text-[10px] text-muted-foreground">
                    Click to upload image
                  </span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="bg-input border-border font-mono-share text-sm text-foreground placeholder:text-muted-foreground focus:neon-border"
            />
          )}
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
      <div className="flex items-center justify-between text-[8px] sm:text-[10px] font-mono-share text-muted-foreground/40 border-t border-border/30 pt-2 gap-2 flex-wrap">
        <span><span className="text-primary/30">mode</span>={mode.toUpperCase().replace(/-/g, "_")}</span>
        {mode !== "text-to-video" && mode !== "image-to-video" && (
          <span className="hidden sm:inline">×{settings.count} • {settings.imageFormat.toUpperCase()}</span>
        )}
        <span>{isLoading ? "⟳ PROCESSING..." : "● READY"}</span>
        <span className="hidden sm:inline">{prompt.length} chars</span>
      </div>
    </form>
  );
};

export default PromptForm;

import React, { useState, useEffect, useRef, useCallback } from "react";
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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
  const needsVideo = mode === "edit-video";

  const isHeicLike = (file: File): boolean => {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    return type === "image/heic" || type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif");
  };

  const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  const fileToDataUrl = async (file: File): Promise<string> => {
    if (!isHeicLike(file)) {
      return readBlobAsDataUrl(file);
    }
    // HEIC/HEIF is often unsupported in browser decoders; convert to JPEG first.
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.92,
    });
    const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
    return readBlobAsDataUrl(convertedBlob as Blob);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    setUploadError(null);

    try {
      const dataUrl = await fileToDataUrl(file);
      setImageUrl(dataUrl);
      setUploadPreview(dataUrl);
      setImageSource("upload");
    } catch (err: any) {
      console.error("[PromptForm] Upload conversion failed:", err?.message || err);
      setUploadError("Could not read this image format. Try JPEG/PNG/WebP, or convert HEIC to JPEG.");
      clearUpload();
    }
  };

  const clearUpload = () => {
    setImageUrl("");
    setUploadPreview(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (needsImage && !imageUrl.trim()) return;
    if (needsVideo && !imageUrl.trim()) return;

    setUploadError(null);
    onSubmit({ prompt: prompt.trim(), imageUrl: imageUrl.trim() || undefined });
  };

  // ── Ctrl+Enter / Cmd+Enter to submit ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }, []);

  // ── Paste image from clipboard ──
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!needsImage) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        setUploadError(null);
        fileToDataUrl(file)
          .then((dataUrl) => {
            setImageUrl(dataUrl);
            setUploadPreview(dataUrl);
            setImageSource("upload");
          })
          .catch((err: any) => {
            console.error("[PromptForm] Paste conversion failed:", err?.message || err);
            setUploadError("Clipboard image format is unsupported. Try JPEG/PNG/WebP.");
          });
        return;
      }
    }
  }, [needsImage]);

  const placeholders: Record<GrokMode, string> = {
    "text-to-image": "Describe the image you want to generate...",
    "edit-image": "Describe the modifications to apply...",
    "text-to-video": "Describe the video scene to render...",
    "image-to-video": "Describe the animation / motion to apply...",
    "edit-video": "Describe the edits to apply to the video...",
  };

  const hasImage = imageSource === "upload" ? !!uploadPreview : !!imageUrl.trim();

  return (
    <form ref={formRef} onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-4">
      {needsVideo && (
        <div className="space-y-2">
          <label className="font-mono-share text-[10px] tracking-wider text-muted-foreground flex items-center gap-2">
            <span className="text-primary/50">$</span>
            <Upload className="w-3 h-3" />
            source_video
            <span className="text-muted-foreground/40 ml-auto">max 8.7s</span>
          </label>
          <Input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/video.mp4"
            className="bg-input border-border font-mono-share text-sm text-foreground placeholder:text-muted-foreground focus:neon-border"
          />
        </div>
      )}
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
                    Click to upload or paste (Ctrl+V) — HEIC auto-converts
                  </span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                onChange={handleFileChange}
                className="hidden"
              />
              {uploadError && (
                <p className="mt-1 font-mono-share text-[10px] text-destructive/80">{uploadError}</p>
              )}
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
            onKeyDown={handleKeyDown}
            placeholder={placeholders[mode]}
            rows={4}
            className="bg-input border-border font-rajdhani text-base text-foreground placeholder:text-muted-foreground focus:neon-border resize-none pr-14"
          />
          <Button
            type="submit"
            disabled={isLoading || !prompt.trim() || (needsImage && !imageUrl.trim()) || (needsVideo && !imageUrl.trim())}
            size="icon"
            className="absolute bottom-3 right-3 bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-30 transition-all"
            title="Submit (Ctrl+Enter)"
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
        {needsImage && (
          <span className={hasImage ? "text-primary/50" : "text-destructive/50"}>
            {hasImage ? "◆ IMG_LOADED" : "○ IMG_REQUIRED"}
          </span>
        )}
        {needsVideo && (
          <span className={imageUrl.trim() ? "text-primary/50" : "text-destructive/50"}>
            {imageUrl.trim() ? "◆ VID_LOADED" : "○ VID_REQUIRED"}
          </span>
        )}
        {mode !== "text-to-video" && mode !== "image-to-video" && mode !== "edit-video" && (
          <span className="hidden sm:inline">×{settings.count}</span>
        )}
        <span>{isLoading ? "⟳ PROCESSING..." : "● READY"}</span>
        <span className="hidden sm:inline">{prompt.length} chars</span>
        <span className="hidden sm:inline text-muted-foreground/20">Ctrl+Enter</span>
      </div>
    </form>
  );
};

export default PromptForm;

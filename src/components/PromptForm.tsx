import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Send, Upload, Loader2, ImagePlus, Link, X, Film, Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { GrokMode, GenerationSettings } from "@/hooks/useGrokApi";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

/** Returns a short human-readable label explaining what the credit cost covers. */
function creditCostLabel(mode: GrokMode, cost: number): string {
  switch (mode) {
    case "text-to-image":
      return `${cost} cr — Grok / Z-Image text-to-image generation`;
    case "edit-image":
      return `${cost} cr — Grok / GLTCH image editing`;
    case "text-to-video":
      return `${cost} cr — video generation (3 cr/s for Grok · 15 cr flat for GLTCH PRO)`;
    case "image-to-video":
      return `${cost} cr — image-to-video animation (3 cr/s for Grok · 15 cr flat for GLTCH PRO)`;
    case "edit-video":
      return `${cost} cr — video editing`;
    default:
      return `${cost} cr`;
  }
}

interface PromptFormProps {
  mode: GrokMode;
  isLoading: boolean;
  onSubmit: (data: { prompt: string; imageUrl?: string; extraImageUrls?: string[] }) => void;
  settings: GenerationSettings;
  initialPrompt?: string;
  initialImageUrl?: string;
  hideExtraImages?: boolean;
  creditCost?: number;
  totalCredits?: number;
  hasSubscription?: boolean;
  onOpenStore?: () => void;
}

const PromptForm: React.FC<PromptFormProps> = ({ mode, isLoading, onSubmit, settings, initialPrompt, initialImageUrl, hideExtraImages, creditCost, totalCredits, hasSubscription, onOpenStore }) => {
  const isLowCredits = creditCost != null && totalCredits != null && totalCredits < creditCost;
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [imageUrl, setImageUrl] = useState(initialImageUrl || "");
  const [imageSource, setImageSource] = useState<"url" | "upload">(initialImageUrl ? "url" : "upload");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [videoSource, setVideoSource] = useState<"url" | "upload">("upload");
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [enhancing, setEnhancing] = useState(false);

  // Extra images for multi-image editing (up to 2 additional = 3 total)
  const [extraImages, setExtraImages] = useState<{ url: string; preview: string }[]>([]);
  const extraFileRefs = useRef<(HTMLInputElement | null)[]>([null, null]);

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

  /**
   * Resize + compress an image blob so the payload stays small enough for the
   * API proxy (≤ 50 MB body).  4K screenshots / camera photos are 20-40MB raw
   * and ~30-55MB as base64, which blows past the limit.
   *
   * Strategy:
   *  - Cap the longest edge at MAX_DIM (4096 px — plenty for xAI's 2K output)
   *  - Re-encode as JPEG at 0.92 quality → typically 1-5 MB
   *  - Small images that are already under the cap pass through untouched
   */
  const MAX_DIM = 4096;
  const compressBlob = async (blob: Blob): Promise<string> => {
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width, h = bitmap.height;
    // If already small enough, just read as-is (preserves PNG transparency etc.)
    if (w <= MAX_DIM && h <= MAX_DIM && blob.size < 4 * 1024 * 1024) {
      bitmap.close();
      return readBlobAsDataUrl(blob);
    }
    // Downscale to fit within MAX_DIM × MAX_DIM
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.92);
  };

  const fileToDataUrl = async (file: File): Promise<string> => {
    let blob: Blob = file;
    if (isHeicLike(file)) {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
      blob = Array.isArray(converted) ? converted[0] : converted;
      // iPhone HEIC can be 48MP — always force through canvas resize to keep payload manageable
      const bitmap = await createImageBitmap(blob);
      let w = bitmap.width, h = bitmap.height;
      const cap = 2048;
      if (w > cap || h > cap) {
        const scale = cap / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      return await new Promise<string>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (!b) return reject(new Error("toBlob failed"));
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(b);
          },
          "image/jpeg",
          0.85,
        );
      });
    }
    return compressBlob(blob);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && !isHeicLike(file)) return;
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
    setExtraImages([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleExtraFileChange = async (e: React.ChangeEvent<HTMLInputElement>, slotIndex: number) => {
    const file = e.target.files?.[0];
    if (!file || (!file.type.startsWith("image/") && !isHeicLike(file))) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setExtraImages(prev => {
        const next = [...prev];
        next[slotIndex] = { url: dataUrl, preview: dataUrl };
        return next;
      });
    } catch {
      // silently skip bad image
    }
  };

  const removeExtraImage = (index: number) => {
    setExtraImages(prev => prev.filter((_, i) => i !== index));
    const ref = extraFileRefs.current[index];
    if (ref) ref.value = "";
  };

  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setUploadError("Please select a video file (MP4, WebM, etc.).");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("Video file too large (max 50 MB).");
      return;
    }
    setUploadError(null);
    const dataUrl = await readBlobAsDataUrl(file);
    setImageUrl(dataUrl);
    setVideoPreview(dataUrl);
    setVideoSource("upload");
  };

  const clearVideoUpload = () => {
    setImageUrl("");
    setVideoPreview(null);
    setUploadError(null);
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (needsImage && !imageUrl.trim()) return;
    if (needsVideo && !imageUrl.trim()) return;

    setUploadError(null);
    const extraUrls = extraImages.map(ei => ei.url).filter(Boolean);
    onSubmit({
      prompt: prompt.trim(),
      imageUrl: imageUrl.trim() || undefined,
      ...(extraUrls.length > 0 ? { extraImageUrls: extraUrls } : {}),
    });
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

  // ── Enhance prompt via Grok LLM ──
  const enhancePrompt = useCallback(async () => {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const modeMap: Record<string, string> = {
        "text-to-image": "image",
        "edit-image": "edit",
        "text-to-video": "video",
        "image-to-video": "video",
        "edit-video": "edit",
      };
      const data = await apiFetch<{ enhanced: string }>("/comfyui", {
        method: "POST",
        body: { action: "enhance-prompt", prompt: prompt.trim(), mode: modeMap[mode] || "image" },
      });
      if (data.enhanced) setPrompt(data.enhanced);
    } catch (err: any) {
      console.error("[PromptForm] Enhance failed:", err?.message || err);
      toast.error("Enhance failed", { description: err?.message || "Try again" });
    } finally {
      setEnhancing(false);
    }
  }, [prompt, mode, enhancing]);

  const placeholders: Record<GrokMode, string> = {
    "text-to-image": "Describe the image you want to generate...",
    "edit-image": "Describe the modifications to apply...",
    "text-to-video": "Describe the video scene to render...",
    "image-to-video": "Describe the animation / motion to apply...",
    "edit-video": "Describe the edits to apply to the video...",
  };

  const suggestedPrompts: Record<GrokMode, string[]> = {
    "text-to-image": ["cinematic portrait", "anime music video still", "uncensored fantasy art", "neon cyberpunk city"],
    "edit-image": ["remove background", "add dramatic lighting", "make it anime style", "enhance details"],
    "text-to-video": ["cinematic camera pan", "anime fight scene", "slow motion explosion", "looping abstract art"],
    "image-to-video": ["subtle breathing motion", "camera slowly zooms in", "hair blowing in wind", "eyes blink slowly"],
    "edit-video": ["add motion blur", "color grade cinematic", "slow it down", "loop seamlessly"],
  };

  const hasImage = imageSource === "upload" ? !!uploadPreview : !!imageUrl.trim();

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-4">
      {needsVideo && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-mono-share text-[10px] tracking-wider text-muted-foreground flex items-center gap-2">
              <span className="text-primary/50">$</span>
              <Upload className="w-3 h-3" />
              source_video
            </label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => { setVideoSource("upload"); setImageUrl(""); }}
                className={`font-mono-share text-[9px] px-2 py-0.5 rounded transition-colors ${videoSource === "upload"
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground border border-border/30"
                  }`}
              >
                <Film className="w-3 h-3 inline mr-1" />
                UPLOAD
              </button>
              <button
                type="button"
                onClick={() => { setVideoSource("url"); clearVideoUpload(); }}
                className={`font-mono-share text-[9px] px-2 py-0.5 rounded transition-colors ${videoSource === "url"
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground border border-border/30"
                  }`}
              >
                <Link className="w-3 h-3 inline mr-1" />
                URL
              </button>
            </div>
          </div>

          {videoSource === "upload" ? (
            <div className="relative">
              {videoPreview ? (
                <div className="relative group">
                  <video
                    src={videoPreview}
                    className="w-full max-h-32 object-contain rounded border border-border bg-input"
                    controls
                    muted
                    playsInline
                    // @ts-ignore
                    webkit-playsinline="true"
                  />
                  <button
                    type="button"
                    onClick={clearVideoUpload}
                    className="absolute top-1 right-1 p-1 rounded bg-background/80 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => videoFileInputRef.current?.click()}
                  className="w-full h-20 border border-dashed border-border rounded flex flex-col items-center justify-center gap-1 bg-input/50 hover:bg-input hover:border-primary/30 transition-colors cursor-pointer"
                >
                  <Film className="w-5 h-5 text-muted-foreground" />
                  <span className="font-mono-share text-[10px] text-muted-foreground">
                    Click to upload video — MP4, WebM (max 50 MB)
                  </span>
                </button>
              )}
              <input
                ref={videoFileInputRef}
                type="file"
                accept="video/*"
                onChange={handleVideoFileChange}
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
              placeholder="https://example.com/video.mp4"
              className="bg-input border-border font-mono-share text-sm text-foreground placeholder:text-muted-foreground focus:neon-border"
            />
          )}
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
                className={`font-mono-share text-[9px] px-2 py-0.5 rounded transition-colors ${imageSource === "upload"
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
                className={`font-mono-share text-[9px] px-2 py-0.5 rounded transition-colors ${imageSource === "url"
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

      {/* Extra images for multi-image editing (Grok edit-image only, up to 3 total) */}
      {mode === "edit-image" && hasImage && !hideExtraImages && (
        <div className="space-y-2">
          <label className="font-mono-share text-[10px] tracking-wider text-muted-foreground flex items-center gap-2">
            <span className="text-primary/50">+</span>
            <ImagePlus className="w-3 h-3" />
            extra_images
            <span className="text-muted-foreground/40 ml-auto">{extraImages.length}/2</span>
          </label>

          <div className="flex gap-2 flex-wrap">
            {extraImages.map((ei, idx) => (
              <div key={idx} className="relative w-20 h-20 shrink-0">
                <img src={ei.preview} alt={`Extra ${idx + 1}`}
                  className="w-full h-full object-cover rounded border border-border bg-input" />
                <button type="button" onClick={() => removeExtraImage(idx)}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-background/90 text-muted-foreground hover:text-destructive transition-colors border border-border">
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}

            {extraImages.length < 2 && (
              <button type="button"
                onClick={() => extraFileRefs.current[extraImages.length]?.click()}
                className="w-20 h-20 border border-dashed border-border rounded flex flex-col items-center justify-center gap-0.5 bg-input/30 hover:bg-input hover:border-primary/30 transition-colors cursor-pointer shrink-0">
                <ImagePlus className="w-4 h-4 text-muted-foreground/50" />
                <span className="font-mono-share text-[7px] text-muted-foreground/50">ADD</span>
              </button>
            )}
          </div>

          {/* Hidden file inputs for extra images */}
          {[0, 1].map(i => (
            <input key={i} ref={el => { extraFileRefs.current[i] = el; }}
              type="file" accept="image/*,.heic,.heif"
              onChange={e => handleExtraFileChange(e, i)}
              className="hidden" />
          ))}

          <p className="font-mono-share text-[8px] text-muted-foreground/40">
            Up to 3 images total — reference them by order in your prompt
          </p>
        </div>
      )}
      {/* Terminal prompt block */}
      <div className="terminal-block rounded-md overflow-hidden">
        {/* Terminal title bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border-b border-primary/15">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-destructive/60" />
            <div className="w-2 h-2 rounded-full bg-neon-yellow/60" />
            <div className="w-2 h-2 rounded-full bg-primary/60" />
          </div>
          <span className="font-mono-share text-[9px] text-muted-foreground/40 flex-1 text-center">
            prompt@grok:~/{mode.replace(/-/g, "_")}
          </span>
          <span className="font-mono-share text-[9px] text-muted-foreground/30">{prompt.length} chars</span>
        </div>

        {/* Input area */}
        <div className="relative p-3">
          <div className="flex items-start gap-2">
            <span className="font-mono-share text-sm text-primary/70 mt-2 select-none shrink-0">
              {isLoading ? "⟳" : "❯"}
            </span>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholders[mode]}
              rows={3}
              className="flex-1 bg-transparent border-0 font-jetbrains text-sm text-foreground placeholder:text-muted-foreground/30 focus:ring-0 focus:outline-none resize-none p-0 pt-1.5 shadow-none focus-visible:ring-0"
            />
          </div>

          {/* Suggested prompt chips */}
          {!prompt.trim() && (
            <div className="flex flex-wrap gap-1.5 mt-2 mb-1">
              {suggestedPrompts[mode].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPrompt(s)}
                  className="font-mono-share text-[9px] px-2 py-1 rounded border border-border/40 bg-card/50 text-muted-foreground/60 hover:border-primary/40 hover:text-primary/80 hover:bg-primary/5 transition-all duration-150"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-primary/10">
            {/* Status indicators */}
            <div className="flex items-center gap-2 font-mono-share text-[9px] text-muted-foreground/40 flex-1 min-w-0">
              {needsImage && (
                <span className={hasImage ? "text-primary/60" : "text-destructive/50"}>
                  {hasImage ? `[IMG_LOADED${extraImages.length > 0 ? ` +${extraImages.length}` : ""}]` : "[IMG_REQUIRED]"}
                </span>
              )}
              {needsVideo && (
                <span className={imageUrl.trim() ? "text-primary/60" : "text-destructive/50"}>
                  {imageUrl.trim() ? "[VID_LOADED]" : "[VID_REQUIRED]"}
                </span>
              )}
              <span className="hidden sm:inline font-mono-share text-[8px] text-muted-foreground/20">Ctrl+Enter</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                onClick={enhancePrompt}
                disabled={enhancing || !prompt.trim() || isLoading}
                size="sm"
                variant="ghost"
                className="h-8 px-2 font-mono-share text-[10px] text-primary/60 hover:text-primary hover:bg-primary/10 disabled:opacity-30 gap-1"
                title="Enhance prompt with Grok AI"
              >
                {enhancing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                <span className="hidden sm:inline">ENHANCE</span>
              </Button>
              <div className="flex flex-col items-end gap-1">
                <TooltipProvider delayDuration={300}>
                  <Button
                    type="submit"
                    disabled={isLoading || !prompt.trim() || (needsImage && !imageUrl.trim()) || (needsVideo && !imageUrl.trim())}
                    className="h-10 px-5 sm:px-8 font-orbitron text-xs sm:text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 gap-2 tracking-widest shadow-[0_0_20px_hsl(var(--primary)/0.4)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-200"
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {isLoading ? "GENERATING…" : "GENERATE"}
                    {!isLoading && creditCost != null && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 rounded-sm bg-primary-foreground/20 border border-primary-foreground/30 px-1.5 py-0.5 font-mono-share text-[10px] font-bold leading-none tabular-nums cursor-help">
                            {creditCost} cr
                            <Info className="w-2.5 h-2.5 opacity-70" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="font-mono-share text-[11px] max-w-[220px] text-center leading-snug">
                          {creditCostLabel(mode, creditCost)}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </Button>
                </TooltipProvider>
                {/* Low-credits warning */}
                {!isLoading && isLowCredits && (
                  <div className="flex items-center gap-1.5 text-[9px] font-mono-share text-destructive/80 bg-destructive/10 border border-destructive/25 rounded px-2 py-1 w-full justify-between">
                    <span>⚠ Need {creditCost! - totalCredits!} more cr</span>
                    {onOpenStore && (
                      <button
                        type="button"
                        onClick={onOpenStore}
                        className="underline underline-offset-2 text-primary/80 hover:text-primary font-bold whitespace-nowrap"
                      >
                        Top up →
                      </button>
                    )}
                  </div>
                )}
                {!isLoading && !isLowCredits && (
                  <span className="font-mono-share text-[8px] text-muted-foreground/35 pr-1">
                    {hasSubscription ? "⚡ Priority queue" : "Subscribe for faster renders"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>

    {/* Sticky mobile CTA — portaled above bottom nav, visible only when prompt has text */}
    {typeof document !== "undefined" && prompt.trim() && createPortal(
      <div className="fixed left-0 right-0 z-40 sm:hidden px-3 pt-2 pb-2 animate-slide-up bg-card/95 backdrop-blur-md border-t border-primary/20" style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}>
        <button
          type="button"
          onClick={() => formRef.current?.requestSubmit()}
          disabled={isLoading || !prompt.trim() || (needsImage && !imageUrl.trim()) || (needsVideo && !imageUrl.trim())}
          className="w-full h-13 font-orbitron text-sm font-bold bg-primary text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-3 tracking-widest rounded shadow-[0_0_28px_hsl(var(--primary)/0.55)] active:scale-[0.98] transition-all duration-150"
          title={creditCost != null ? creditCostLabel(mode, creditCost) : undefined}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
          <span>{isLoading ? "GENERATING…" : "GENERATE"}</span>
          {!isLoading && creditCost != null && (
            <span className="inline-flex items-center gap-1 rounded bg-primary-foreground/20 border border-primary-foreground/40 px-2 py-1 font-mono-share text-xs font-bold leading-none tabular-nums tracking-normal">
              {creditCost} cr
              <Info className="w-3 h-3 opacity-60" />
            </span>
          )}
        </button>
      </div>,
      document.body
    )}
    </>
  );
};

export default PromptForm;

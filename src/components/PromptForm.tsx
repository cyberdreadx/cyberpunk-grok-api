import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Send, Upload, Loader2, ImagePlus, Link, X, Sparkles, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { GrokMode, GenerationSettings } from "@/hooks/useGrokApi";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { normalizeToImageBlob, isAcceptableImageLike } from "@/lib/heicConvert";

interface CostBreakdown {
  lines: string[];   // e.g. ["2 cr/image", "× 3 images", "= 6 cr total"]
  note?: string;     // optional small footnote
}

function creditCostBreakdown(mode: GrokMode, cost: number, imageCount: number, videoDuration: number): CostBreakdown {
  switch (mode) {
    case "text-to-image":
      return imageCount > 1
        ? { lines: [`${Math.round(cost / imageCount)} cr / image`, `× ${imageCount} images`, `= ${cost} cr total`], note: "Z-Image · GLTCH" }
        : { lines: [`${cost} cr / image`], note: "Z-Image · GLTCH" };
    case "edit-image":
      return imageCount > 1
        ? { lines: [`${Math.round(cost / imageCount)} cr / image`, `× ${imageCount} images`, `= ${cost} cr total`], note: "GLTCH image editing" }
        : { lines: [`${cost} cr / image`], note: "GLTCH image editing" };
    case "text-to-video":
    case "image-to-video": {
      const isFlat = cost === 15;
      return isFlat
        ? { lines: [`${cost} cr flat rate`], note: "GLTCH PRO / ComfyUI WAN 2.2" }
        : { lines: [`3 cr / second`, `× ${videoDuration}s`, `= ${cost} cr total`], note: "GLTCH video engine" };
    }
    default:
      return { lines: [`${cost} cr`] };
  }
}

/** Tooltip-safe one-liner fallback (used for mobile title attr) */
function creditCostLabel(mode: GrokMode, cost: number): string {
  switch (mode) {
    case "text-to-image": return `${cost} cr — text-to-image generation`;
    case "edit-image":    return `${cost} cr — image editing`;
    case "text-to-video":
    case "image-to-video":    return cost === 15 ? `${cost} cr flat — GLTCH/ComfyUI` : `3 cr/s × ${cost/3}s = ${cost} cr`;
    default:              return `${cost} cr`;
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
  videoDuration?: number;
  hasSubscription?: boolean;
  onOpenStore?: () => void;
  /** Overrides the prompt-enhancer mode (e.g. "ltx" for the LTX-2.3 engine). */
  enhanceMode?: string;
}

const PromptForm: React.FC<PromptFormProps> = ({ mode, isLoading, onSubmit, settings, initialPrompt, initialImageUrl, hideExtraImages, creditCost, totalCredits, videoDuration, hasSubscription, onOpenStore, enhanceMode }) => {
  const { t } = useTranslation();
  const isLowCredits = creditCost != null && totalCredits != null && totalCredits < creditCost;
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [imageUrl, setImageUrl] = useState(initialImageUrl || "");
  const [imageSource, setImageSource] = useState<"url" | "upload">(initialImageUrl ? "url" : "upload");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [enhancing, setEnhancing] = useState(false);

  // Extra images for multi-image editing (up to 2 additional = 3 total)
  const [extraImages, setExtraImages] = useState<{ url: string; preview: string }[]>([]);
  const extraFileRefs = useRef<(HTMLInputElement | null)[]>([null, null]);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (!initialImageUrl) return;
    setImageUrl(initialImageUrl);
    setImageSource("url");
    setUploadPreview(null);
    setUploadError(null);
  }, [initialImageUrl]);

  const needsImage = mode === "edit-image" || mode === "image-to-video";

  const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  /**
   * Resize an image client-side (cap at 4096px) and upload it to Vercel Blob
   * via the client-upload protocol. Returns the public CDN URL.
   */
  const MAX_DIM = 4096;

  const resizeBlobIfNeeded = async (blob: Blob): Promise<Blob> => {
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width, h = bitmap.height;
    if (w <= MAX_DIM && h <= MAX_DIM && blob.size <= 8 * 1024 * 1024) {
      bitmap.close();
      return blob;
    }
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.9,
      );
    });
  };

  // Generation inputs stay ON-DEVICE as data URLs — every engine path either
  // sends base64 itself or (Seedance) re-hosts server-side for the job only.
  // Uploading originals to cloud storage here was a privacy leak with no
  // consumer; do not reintroduce it.
  const setLocalPreview = async (blob: Blob) => {
    const dataUrl = await readBlobAsDataUrl(blob);
    setUploadPreview(dataUrl);
    setImageSource("upload");
    return dataUrl;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!(await isAcceptableImageLike(file))) {
      setUploadError("Unsupported file. Use JPG, PNG, WebP, or HEIC.");
      return;
    }
    setUploadError(null);

    let blob: Blob;
    try {
      blob = await normalizeToImageBlob(file, 0.9);
      if (blob.type.startsWith("image/")) {
        blob = await resizeBlobIfNeeded(blob);
      }
    } catch (err: any) {
      console.error("[PromptForm] Image normalize failed:", err?.message || err);
      setUploadError(err?.message || "Could not read this image.");
      return;
    }

    const localDataUrl = await setLocalPreview(blob);
    setImageUrl(localDataUrl);
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
    if (!file || !(await isAcceptableImageLike(file))) return;

    let blob: Blob;
    try {
      blob = await normalizeToImageBlob(file, 0.9);
      if (blob.type.startsWith("image/")) {
        blob = await resizeBlobIfNeeded(blob);
      }
    } catch {
      return;
    }

    const localPreview = await readBlobAsDataUrl(blob);
    setExtraImages(prev => {
      const next = [...prev];
      next[slotIndex] = { url: localPreview, preview: localPreview };
      return next;
    });
  };

  const removeExtraImage = (index: number) => {
    setExtraImages(prev => prev.filter((_, i) => i !== index));
    const ref = extraFileRefs.current[index];
    if (ref) ref.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (needsImage && !imageUrl.trim()) return;

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
        void (async () => {
          let blob: Blob;
          try {
            blob = await normalizeToImageBlob(file, 0.9);
            if (blob.type.startsWith("image/")) {
              blob = await resizeBlobIfNeeded(blob);
            }
          } catch (err: any) {
            setUploadError(err?.message || "Could not read pasted image.");
            return;
          }
          const localDataUrl = await setLocalPreview(blob);
          setImageUrl(localDataUrl);
        })();
        return;
      }
    }
  }, [needsImage]);

  // ── Enhance prompt via DeepSeek LLM (costs 1 credit) ──
  const enhancePrompt = useCallback(async () => {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const modeMap: Record<string, string> = {
        "text-to-image": "image",
        "edit-image": "edit",
        "text-to-video": "video",
        "image-to-video": "video",
      };
      const data = await apiFetch<{ enhanced: string }>("/comfyui", {
        method: "POST",
        body: { action: "enhance-prompt", prompt: prompt.trim(), mode: enhanceMode || modeMap[mode] || "image" },
      });
      if (data.enhanced) setPrompt(data.enhanced);
    } catch (err: any) {
      console.error("[PromptForm] Enhance failed:", err?.message || err);
      toast.error("Enhance failed", { description: err?.message || "Try again" });
    } finally {
      setEnhancing(false);
    }
  }, [prompt, mode, enhancing, enhanceMode]);

  const placeholders: Record<GrokMode, string> = {
    "text-to-image": t("prompt.placeholder"),
    "edit-image": t("prompt.placeholderEdit"),
    "text-to-video": t("prompt.placeholderVideo"),
    "image-to-video": t("prompt.placeholderAnimate"),
  };

  const suggestedPrompts: Record<GrokMode, string[]> = {
    "text-to-image": ["cinematic portrait", "anime music video still", "uncensored fantasy art", "neon cyberpunk city"],
    "edit-image": ["remove background", "add dramatic lighting", "make it anime style", "enhance details"],
    "text-to-video": ["cinematic camera pan", "anime fight scene", "slow motion explosion", "looping abstract art"],
    "image-to-video": ["subtle breathing motion", "camera slowly zooms in", "hair blowing in wind", "eyes blink slowly"],
  };

  const uploadDisplaySrc = uploadPreview || (imageSource === "upload" ? imageUrl.trim() : "");
  const hasImage = imageSource === "upload" ? !!uploadDisplaySrc : !!imageUrl.trim();

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-4">
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
              {uploadDisplaySrc ? (
                <div className="relative group">
                  <img
                    src={uploadDisplaySrc}
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
                accept="image/*,.heic,.heif,.hif,.mov,video/quicktime"
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
              type="file" accept="image/*,.heic,.heif,.hif,.mov,video/quicktime"
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
            prompt@gltch:~/{mode.replace(/-/g, "_")}
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

          <div className="flex items-center mt-2">
            <Button
              type="button"
              onClick={enhancePrompt}
              disabled={enhancing || !prompt.trim() || isLoading}
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 font-mono-share text-[10px] text-primary/70 hover:text-primary hover:bg-primary/10 disabled:opacity-30 gap-1.5 border border-primary/20 rounded"
              title="Rewrite your prompt with AI · costs 1 credit"
            >
              {enhancing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              <span>{t("prompt.enhance").toUpperCase()}</span>
              <span className="text-primary/40">1cr</span>
            </Button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-primary/10">
            {/* Status indicators */}
            <div className="flex items-center gap-2 font-mono-share text-[9px] text-muted-foreground/40 flex-1 min-w-0">
              {needsImage && (
                <span className={hasImage ? "text-primary/60" : "text-destructive/50"}>
                  {hasImage ? `[IMG_LOADED${extraImages.length > 0 ? ` +${extraImages.length}` : ""}]` : "[IMG_REQUIRED]"}
                </span>
              )}
              <span className="hidden sm:inline font-mono-share text-[8px] text-muted-foreground/20">Ctrl+Enter</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col items-end gap-1">
                <TooltipProvider delayDuration={300}>
                  <Button
                    type="submit"
                    disabled={isLoading || !prompt.trim() || (needsImage && !imageUrl.trim())}
                    className="h-10 px-5 sm:px-8 font-orbitron text-xs sm:text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 gap-2 tracking-widest shadow-glow-live hover:shadow-glow-ambient transition-all duration-200"
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {isLoading ? t("prompt.generating").toUpperCase() : t("prompt.generate").toUpperCase()}
                    {!isLoading && creditCost != null && (() => {
                      const bd = creditCostBreakdown(mode, creditCost, settings.count ?? 1, videoDuration ?? 5);
                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 rounded-sm bg-primary-foreground/20 border border-primary-foreground/30 px-1.5 py-0.5 font-mono-share text-[10px] font-bold leading-none tabular-nums cursor-help">
                              {creditCost} cr
                              <Info className="w-2.5 h-2.5 opacity-70" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="font-mono-share text-[11px] max-w-[200px] leading-snug p-3">
                            <div className="space-y-1">
                              {bd.lines.map((line, i) => (
                                <div key={i} className={`tabular-nums ${i === bd.lines.length - 1 && bd.lines.length > 1 ? "text-primary font-bold border-t border-border/40 pt-1 mt-0.5" : "text-foreground/80"}`}>
                                  {line}
                                </div>
                              ))}
                              {bd.note && <div className="text-muted-foreground/60 text-[10px] pt-0.5">{bd.note}</div>}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                  </Button>
                </TooltipProvider>
                {/* Low-credits warning */}
                {!isLoading && isLowCredits && (
                  <div className="flex items-center gap-1.5 text-[9px] font-mono-share text-destructive/80 bg-destructive/10 border border-destructive/25 rounded px-2 py-1 w-full justify-between">
                    <span>⚠ {t("prompt.needMore", { count: creditCost! - totalCredits! })}</span>
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
                    {hasSubscription ? `⚡ ${t("prompt.priorityQueue")}` : t("prompt.subscribeFaster")}
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
        {/* Low-credits warning strip */}
        {!isLoading && isLowCredits && (
          <div className="flex items-center justify-between font-mono-share text-[10px] text-destructive/90 bg-destructive/10 border border-destructive/25 rounded px-2.5 py-1.5 mb-1.5">
            <span>⚠ Need {creditCost! - totalCredits!} more cr to generate</span>
            {onOpenStore && (
              <button
                type="button"
                onClick={onOpenStore}
                className="underline underline-offset-2 text-primary/90 hover:text-primary font-bold ml-2 whitespace-nowrap"
              >
                Top up →
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => formRef.current?.requestSubmit()}
          disabled={isLoading || !prompt.trim() || (needsImage && !imageUrl.trim())}
          className="w-full h-13 font-orbitron text-sm font-bold bg-primary text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-3 tracking-widest rounded shadow-glow-ambient active:scale-[0.98] transition-all duration-150"
          title={creditCost != null ? creditCostLabel(mode, creditCost) : undefined}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
          <span>{isLoading ? t("prompt.generating").toUpperCase() : t("prompt.generate").toUpperCase()}</span>
          {!isLoading && creditCost != null && (
            <span className={`inline-flex items-center gap-1 rounded px-2 py-1 font-mono-share text-xs font-bold leading-none tabular-nums tracking-normal border ${isLowCredits ? "bg-destructive/30 border-destructive/50 text-destructive-foreground" : "bg-primary-foreground/20 border-primary-foreground/40"}`}>
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

import React, { useState, useCallback, useRef } from "react";
import { Upload, Sparkles, Pencil, Image, Film, X, Loader2 } from "lucide-react";
import type { GrokMode } from "@/hooks/useGrokApi";

interface SimpleModeProps {
  onSubmit: (data: { prompt: string; imageUrl?: string; extraImageUrls?: string[] }) => void;
  isLoading: boolean;
  creditCost?: number;
  totalCredits?: number;
  onModeChange: (mode: GrokMode) => void;
  onImageUrlChange: (url: string) => void;
  currentMode: GrokMode;
}

const SIMPLE_TABS = [
  { id: "edit-image" as GrokMode, label: "Edit Image", icon: Pencil, description: "Upload an image and describe changes" },
  { id: "text-to-image" as GrokMode, label: "Create Image", icon: Image, description: "Describe what you want to create" },
  { id: "image-to-video" as GrokMode, label: "Make Video", icon: Film, description: "Turn an image into a short video" },
] as const;

const SIMPLE_SUGGESTIONS: Record<string, string[]> = {
  "edit-image": [
    "Make it look like a painting",
    "Change the background to a sunset",
    "Add neon glow effects",
    "Make it anime style",
    "Remove the background",
    "Add dramatic lighting",
  ],
  "text-to-image": [
    "A cyberpunk city at night with neon lights",
    "A beautiful landscape with mountains and a lake",
    "A cute cat wearing sunglasses",
    "Abstract art with vibrant colors",
    "A futuristic spaceship in deep space",
    "A cozy coffee shop on a rainy day",
  ],
  "image-to-video": [
    "Slow zoom in with gentle movement",
    "Camera pans across the scene",
    "Dramatic wind and motion",
    "Subtle animation with floating particles",
  ],
};

const SimpleMode: React.FC<SimpleModeProps> = ({
  onSubmit,
  isLoading,
  creditCost,
  totalCredits,
  onModeChange,
  onImageUrlChange,
  currentMode,
}) => {
  const [prompt, setPrompt] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTab = SIMPLE_TABS.find(t => t.id === currentMode) ? currentMode : "edit-image";

  const handleTabChange = useCallback((mode: GrokMode) => {
    onModeChange(mode);
    if (mode === "text-to-image") {
      setImagePreview(null);
      onImageUrlChange("");
    }
  }, [onModeChange, onImageUrlChange]);

  const handleImageUpload = useCallback(async (file: File) => {
    // Convert HEIC if needed
    let blob: Blob = file;
    if (file.name.toLowerCase().match(/\.heic|\.heif$/)) {
      try {
        const heic2any = (await import("heic2any")).default;
        blob = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 })) as Blob;
      } catch { /* use original */ }
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      onImageUrlChange(dataUrl);
    };
    reader.readAsDataURL(blob);
  }, [onImageUrlChange]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
  }, [handleImageUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleImageUpload(file);
  }, [handleImageUpload]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { handleImageUpload(file); break; }
      }
    }
  }, [handleImageUpload]);

  const clearImage = useCallback(() => {
    setImagePreview(null);
    onImageUrlChange("");
  }, [onImageUrlChange]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) return;
    const needsImage = activeTab === "edit-image" || activeTab === "image-to-video";
    if (needsImage && !imagePreview) return;
    onSubmit({ prompt: prompt.trim(), imageUrl: imagePreview || undefined });
  }, [prompt, imagePreview, activeTab, onSubmit]);

  const needsImage = activeTab === "edit-image" || activeTab === "image-to-video";
  const canGenerate = prompt.trim().length > 0 && (!needsImage || !!imagePreview) && !isLoading;
  const insufficientCredits = creditCost !== undefined && totalCredits !== undefined && totalCredits < creditCost;

  const suggestions = SIMPLE_SUGGESTIONS[activeTab] || [];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-card/40 border border-border/50 rounded-lg">
        {SIMPLE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`
                flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-md transition-all duration-200 font-mono-share text-xs
                ${isActive
                  ? "bg-primary/10 border border-primary/30 text-primary shadow-sm"
                  : "text-muted-foreground/60 hover:text-foreground/80 hover:bg-card/60"
                }
              `}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Description */}
      <p className="font-mono-share text-xs text-muted-foreground/60 text-center">
        {SIMPLE_TABS.find(t => t.id === activeTab)?.description}
      </p>

      {/* Image upload area (for edit & video modes) */}
      {needsImage && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`
            relative rounded-lg border-2 border-dashed transition-all duration-200 overflow-hidden
            ${imagePreview
              ? "border-primary/30 bg-card/30"
              : dragOver
                ? "border-primary/60 bg-primary/5"
                : "border-border/50 bg-card/20 hover:border-primary/30"
            }
          `}
        >
          {imagePreview ? (
            <div className="relative">
              <img
                src={imagePreview}
                alt="Upload preview"
                className="w-full max-h-64 object-contain"
              />
              <button
                onClick={clearImage}
                className="absolute top-2 right-2 p-1.5 bg-background/80 backdrop-blur-sm rounded-full text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-12 flex flex-col items-center gap-3 cursor-pointer"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="w-5 h-5 text-primary/60" />
              </div>
              <div className="text-center">
                <p className="font-mono-share text-sm text-foreground/70">
                  Drop an image here or click to upload
                </p>
                <p className="font-mono-share text-[10px] text-muted-foreground/40 mt-1">
                  JPG, PNG, WebP, HEIC supported · Paste from clipboard works too
                </p>
              </div>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* Prompt input */}
      <div className="relative" onPaste={handlePaste}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            activeTab === "edit-image"
              ? "Describe how to change the image..."
              : activeTab === "image-to-video"
                ? "Describe the motion or animation..."
                : "Describe what you want to create..."
          }
          rows={3}
          className="w-full bg-card/60 border border-border/50 rounded-lg px-4 py-3 text-sm font-mono-share text-foreground placeholder:text-muted-foreground/30 resize-none outline-none focus:border-primary/50 transition-colors"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canGenerate) {
              e.preventDefault();
              handleGenerate();
            }
          }}
        />
      </div>

      {/* Suggestion chips */}
      {!prompt && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              className="px-2.5 py-1.5 rounded-full border border-border/40 bg-card/30 font-mono-share text-[10px] text-muted-foreground/60 hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate || insufficientCredits}
        className={`
          w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-lg font-orbitron text-sm font-bold tracking-wider transition-all duration-200
          ${canGenerate && !insufficientCredits
            ? "bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 hover:border-primary hover:shadow-[0_0_20px_hsl(var(--primary)/0.2)]"
            : "bg-card/30 border border-border/30 text-muted-foreground/30 cursor-not-allowed"
          }
        `}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            GENERATING...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            {activeTab === "edit-image" ? "APPLY EDIT" : activeTab === "image-to-video" ? "ANIMATE" : "GENERATE"}
            {creditCost !== undefined && (
              <span className="ml-1 text-xs font-mono-share opacity-60">
                ({creditCost} cr)
              </span>
            )}
          </>
        )}
      </button>

      {/* Insufficient credits warning */}
      {insufficientCredits && (
        <p className="text-center font-mono-share text-[10px] text-destructive/70">
          Not enough credits — you need {creditCost} but have {totalCredits}
        </p>
      )}
    </div>
  );
};

export default SimpleMode;

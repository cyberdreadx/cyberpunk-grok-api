import React, { useState, useCallback, useRef, useEffect } from "react";
import { Upload, Sparkles, Pencil, Image, Film, X, Loader2, ChevronRight } from "lucide-react";
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

/* ── Walkthrough Steps ────────────────────────────────────── */

interface WalkthroughStep {
  target: string; // data-tour attribute value
  title: string;
  description: string;
  position: "top" | "bottom";
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    target: "tour-tabs",
    title: "1. Pick what to do",
    description: "Choose Edit Image, Create Image, or Make Video. We'll start with editing.",
    position: "bottom",
  },
  {
    target: "tour-upload",
    title: "2. Upload your image",
    description: "Drag & drop, click to browse, or paste from clipboard. Supports JPG, PNG, WebP, and HEIC.",
    position: "bottom",
  },
  {
    target: "tour-prompt",
    title: "3. Describe the change",
    description: "Tell the AI what to do — e.g. \"Make it anime style\" or \"Add neon glow effects\". Try a suggestion chip!",
    position: "top",
  },
  {
    target: "tour-generate",
    title: "4. Hit Generate!",
    description: "Once you've uploaded an image and typed a prompt, press this button. Your edited image appears below.",
    position: "top",
  },
];

const TOUR_STORAGE_KEY = "simple-walkthrough-done";

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

  // Walkthrough state
  const [tourStep, setTourStep] = useState<number>(() => {
    if (localStorage.getItem(TOUR_STORAGE_KEY)) return -1;
    return 0;
  });
  const isTourActive = tourStep >= 0 && tourStep < WALKTHROUGH_STEPS.length;

  const advanceTour = useCallback(() => {
    setTourStep(prev => {
      const next = prev + 1;
      if (next >= WALKTHROUGH_STEPS.length) {
        localStorage.setItem(TOUR_STORAGE_KEY, "1");
        return -1;
      }
      return next;
    });
  }, []);

  const dismissTour = useCallback(() => {
    setTourStep(-1);
    localStorage.setItem(TOUR_STORAGE_KEY, "1");
  }, []);

  const activeTab = SIMPLE_TABS.find(t => t.id === currentMode) ? currentMode : "edit-image";

  const handleTabChange = useCallback((mode: GrokMode) => {
    onModeChange(mode);
    if (mode === "text-to-image") {
      setImagePreview(null);
      onImageUrlChange("");
    }
  }, [onModeChange, onImageUrlChange]);

  const handleImageUpload = useCallback(async (file: File) => {
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
      // Auto-advance tour when image is uploaded
      if (tourStep === 1) advanceTour();
    };
    reader.readAsDataURL(blob);
  }, [onImageUrlChange, tourStep, advanceTour]);

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
    // Finish tour on generate
    if (tourStep === 3) {
      localStorage.setItem(TOUR_STORAGE_KEY, "1");
      setTourStep(-1);
    }
  }, [prompt, imagePreview, activeTab, onSubmit, tourStep]);

  const needsImage = activeTab === "edit-image" || activeTab === "image-to-video";
  const canGenerate = prompt.trim().length > 0 && (!needsImage || !!imagePreview) && !isLoading;
  const insufficientCredits = creditCost !== undefined && totalCredits !== undefined && totalCredits < creditCost;

  const suggestions = SIMPLE_SUGGESTIONS[activeTab] || [];

  return (
    <div className="space-y-4 relative">
      {/* Backdrop overlay when tour is active */}
      {isTourActive && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-[2px] z-40"
          onClick={dismissTour}
        />
      )}

      {/* Tab bar */}
      <div className="relative" data-tour="tour-tabs">
        {isTourActive && tourStep === 0 && <TourTooltip step={WALKTHROUGH_STEPS[0]} onNext={advanceTour} onDismiss={dismissTour} stepNum={0} totalSteps={WALKTHROUGH_STEPS.length} />}
        <div className={`flex gap-1 p-1 bg-card/40 border border-border/50 rounded-lg transition-all ${isTourActive && tourStep === 0 ? "relative z-50 ring-2 ring-primary/50 ring-offset-2 ring-offset-background rounded-lg" : ""}`}>
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
      </div>

      {/* Description */}
      <p className="font-mono-share text-xs text-muted-foreground/60 text-center">
        {SIMPLE_TABS.find(t => t.id === activeTab)?.description}
      </p>

      {/* Image upload area (for edit & video modes) */}
      {needsImage && (
        <div className="relative" data-tour="tour-upload">
          {isTourActive && tourStep === 1 && <TourTooltip step={WALKTHROUGH_STEPS[1]} onNext={advanceTour} onDismiss={dismissTour} stepNum={1} totalSteps={WALKTHROUGH_STEPS.length} />}
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
              ${isTourActive && tourStep === 1 ? "relative z-50 ring-2 ring-primary/50 ring-offset-2 ring-offset-background rounded-lg" : ""}
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
        </div>
      )}

      {/* Prompt input */}
      <div className="relative" data-tour="tour-prompt" onPaste={handlePaste}>
        {isTourActive && tourStep === 2 && <TourTooltip step={WALKTHROUGH_STEPS[2]} onNext={advanceTour} onDismiss={dismissTour} stepNum={2} totalSteps={WALKTHROUGH_STEPS.length} />}
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            // Auto-advance when user starts typing
            if (tourStep === 2 && e.target.value.trim().length > 3) advanceTour();
          }}
          placeholder={
            activeTab === "edit-image"
              ? "Describe how to change the image..."
              : activeTab === "image-to-video"
                ? "Describe the motion or animation..."
                : "Describe what you want to create..."
          }
          rows={3}
          className={`w-full bg-card/60 border border-border/50 rounded-lg px-4 py-3 text-sm font-mono-share text-foreground placeholder:text-muted-foreground/30 resize-none outline-none focus:border-primary/50 transition-colors ${isTourActive && tourStep === 2 ? "relative z-50 ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : ""}`}
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
        <div className={`flex flex-wrap gap-1.5 ${isTourActive && tourStep === 2 ? "relative z-50" : ""}`}>
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              onClick={() => {
                setPrompt(s);
                if (tourStep === 2) advanceTour();
              }}
              className="px-2.5 py-1.5 rounded-full border border-border/40 bg-card/30 font-mono-share text-[10px] text-muted-foreground/60 hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Generate button */}
      <div className="relative" data-tour="tour-generate">
        {isTourActive && tourStep === 3 && <TourTooltip step={WALKTHROUGH_STEPS[3]} onNext={advanceTour} onDismiss={dismissTour} stepNum={3} totalSteps={WALKTHROUGH_STEPS.length} />}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || insufficientCredits}
          className={`
            w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-lg font-orbitron text-sm font-bold tracking-wider transition-all duration-200
            ${canGenerate && !insufficientCredits
              ? "bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 hover:border-primary hover:shadow-[0_0_20px_hsl(var(--primary)/0.2)]"
              : "bg-card/30 border border-border/30 text-muted-foreground/30 cursor-not-allowed"
            }
            ${isTourActive && tourStep === 3 ? "relative z-50 ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : ""}
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
      </div>

      {/* Insufficient credits warning */}
      {insufficientCredits && (
        <p className="text-center font-mono-share text-[10px] text-destructive/70">
          Not enough credits — you need {creditCost} but have {totalCredits}
        </p>
      )}
    </div>
  );
};

/* ── Tour Tooltip Component ───────────────────────────────── */

interface TourTooltipProps {
  step: WalkthroughStep;
  onNext: () => void;
  onDismiss: () => void;
  stepNum: number;
  totalSteps: number;
}

const TourTooltip: React.FC<TourTooltipProps> = ({ step, onNext, onDismiss, stepNum, totalSteps }) => {
  const isLast = stepNum === totalSteps - 1;
  const isTop = step.position === "top";

  return (
    <div className={`absolute left-1/2 -translate-x-1/2 z-[60] animate-slide-up ${isTop ? "bottom-full mb-3" : "top-full mt-3"}`}>
      <div className="relative bg-card border border-primary/40 rounded-lg px-4 py-3 shadow-xl shadow-primary/10 w-[280px] sm:w-[320px]">
        {/* Arrow */}
        <div className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-card border-primary/40 ${
          isTop ? "bottom-[-7px] border-r border-b" : "-top-[7px] border-l border-t"
        }`} />

        {/* Step indicator dots */}
        <div className="flex items-center gap-1.5 mb-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === stepNum ? "bg-primary" : i < stepNum ? "bg-primary/40" : "bg-border"
              }`}
            />
          ))}
          <span className="ml-auto font-mono-share text-[8px] text-muted-foreground/40">
            {stepNum + 1}/{totalSteps}
          </span>
        </div>

        {/* Content */}
        <h4 className="font-orbitron text-xs font-bold text-primary tracking-wide mb-1 relative z-10">
          {step.title}
        </h4>
        <p className="font-mono-share text-[11px] text-foreground/70 leading-relaxed relative z-10">
          {step.description}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between mt-3 relative z-10">
          <button
            onClick={onDismiss}
            className="font-mono-share text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            SKIP TOUR
          </button>
          <button
            onClick={onNext}
            className="flex items-center gap-1 font-mono-share text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
          >
            {isLast ? "FINISH ✓" : "NEXT"}
            {!isLast && <ChevronRight className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SimpleMode;

import React, { useState, useCallback, useRef, Suspense } from "react";
import { Terminal, Key, Coins, Shield, Eye, MessageCircle, HelpCircle, Server, Zap, Cpu, ChevronDown, Film, X, AlertCircle, CheckCircle2, Loader2, Upload, Users } from "lucide-react";
import { Link } from "react-router-dom";
import CyberLayout from "@/components/CyberLayout";

// Lazy-load the 3D orb — Three.js is ~800 KB and not needed for initial render
const GrokOrb = React.lazy(() => import("@/components/GrokOrb"));
import GlitchText from "@/components/GlitchText";
import ModeSelector from "@/components/ModeSelector";
import PromptForm from "@/components/PromptForm";
import SettingsPanel from "@/components/SettingsPanel";
import PromptHistory from "@/components/PromptHistory";
import ResultsGrid from "@/components/ResultsGrid";
import ApiKeyDialog from "@/components/ApiKeyDialog";
import AuthDialog from "@/components/AuthDialog";
import CreditDisplay from "@/components/CreditDisplay";
import LegalDialog from "@/components/LegalDialog";
import HowToUseDialog from "@/components/HowToUseDialog";
import { useGrokApi, urlToBase64, getImageDimensions, type GrokMode, type GenerationSettings, type VideoSettings, type ApiMode, type VideoLoraEntry, type ComfyJob, DEFAULT_SETTINGS, DEFAULT_VIDEO_SETTINGS } from "@/hooks/useGrokApi";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useFolders } from "@/hooks/useFolders";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { useToast } from "@/hooks/use-toast";
import { calculateCreditCost, type CreditMode } from "@/lib/api";

const ANNOUNCEMENTS: { id: string; message: string; type?: "info" | "warning" | "success" }[] = [
  { id: "gltch-wan-launch", message: "GLTCH WAN 2.2 I2V — Lightx2v + Pusa enhanced motions pipeline in ANIMATE mode.", type: "info" },
];

const SFW_LORA_KEYWORDS = ["skin", "angle"];
const isNsfwLora = (name: string) => !SFW_LORA_KEYWORDS.some(k => name.toLowerCase().includes(k));

const Index = () => {
  const [mode, setMode] = useState<GrokMode>("text-to-image");
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("dismissed_announcements") || "[]");
    } catch { return []; }
  });
  const dismissAnnouncement = useCallback((id: string) => {
    setDismissedAnnouncements(prev => {
      const next = [...prev, id];
      localStorage.setItem("dismissed_announcements", JSON.stringify(next));
      return next;
    });
  }, []);
  const visibleAnnouncements = ANNOUNCEMENTS.filter(a => !dismissedAnnouncements.includes(a.id));
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    try {
      const saved = localStorage.getItem("grok-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(() => {
    try {
      const saved = localStorage.getItem("grok-video-settings");
      return saved ? { ...DEFAULT_VIDEO_SETTINGS, ...JSON.parse(saved) } : DEFAULT_VIDEO_SETTINGS;
    } catch {
      return DEFAULT_VIDEO_SETTINGS;
    }
  });

  const handleSettingsChange = (next: GenerationSettings) => {
    setSettings(next);
    localStorage.setItem("grok-settings", JSON.stringify(next));
  };
  const handleVideoSettingsChange = (next: VideoSettings) => {
    setVideoSettings(next);
    localStorage.setItem("grok-video-settings", JSON.stringify(next));
  };
  const { toast } = useToast();
  const {
    isLoading,
    error,
    results,
    elapsedSeconds,
    apiMode,
    setApiMode,
    setApiKey: setApiKeyRaw,
    clearApiKey: clearApiKeyRaw,
    hasApiKey,
    generateImage,
    editImage,
    grokEditQueued,
    generateVideo,
    editVideo,
    comfyGenerate,
    comfyEdit,
    comfyVideo,
    comfyTextToVideo,
    comfyLongLook,
    comfyPhase,
    comfyJobs,
    dismissComfyJob,
    clearFinishedComfyJobs,
    comfyModels,
    fetchComfyModels,
    clearResults,
    deleteResult,
    updateResultFolder,
    addExternalResult,
    clearError,
  } = useGrokApi();

  // Auth & Credits
  const auth = useAuth();
  const creditsHook = useCredits(auth.user);
  const isAdmin = auth.user?.email === "cyberdreadx@proton.me";
  const [adminTestCredits, setAdminTestCredits] = useState(false);
  const adminBypass = isAdmin && !adminTestCredits;

  // Folders
  const foldersHook = useFolders();

  const { history, addEntry, removeEntry, clearHistory } = usePromptHistory();
  const [activePrompt, setActivePrompt] = useState("");
  const [activeImageUrl, setActiveImageUrl] = useState("");

  // Engine selectors per mode
  type EditEngine = "grok" | "gltch";
  const [editEngine, setEditEngine] = useState<EditEngine>("grok");
  const [grokPro, setGrokPro] = useState(false);
  const [qwenLoraStack, setQwenLoraStack] = useState<{ name: string; strengthModel: number; strengthClip: number }[]>([]);
  const [comfyEditUpscale, setComfyEditUpscale] = useState(false);
  const [gltchImage2, setGltchImage2] = useState<string | null>(null);
  const [gltchImage2Name, setGltchImage2Name] = useState("");
  const gltchImage2Ref = useRef<HTMLInputElement>(null);

  type ComfyEngine = "grok" | "comfy" | "gltch";
  const [genEngine, setGenEngine] = useState<ComfyEngine>("grok");
  const [renderEngine, setRenderEngine] = useState<ComfyEngine>("comfy");
  const [animateEngine, setAnimateEngine] = useState<ComfyEngine>("grok");

  // ComfyUI settings
  const [comfyCheckpoint, setComfyCheckpoint] = useState("");
  const [comfyLora, setComfyLora] = useState("none");
  const [comfyLoraStrength, setComfyLoraStrength] = useState(0.8);
  const [comfyNegPrompt, setComfyNegPrompt] = useState("");
  const [comfyWidth, setComfyWidth] = useState(832);
  const [comfyHeight, setComfyHeight] = useState(480);
  const [comfySteps, setComfySteps] = useState(5);
  const [comfyCfg, setComfyCfg] = useState(1);
  const [comfyFrameCount, setComfyFrameCount] = useState(81);
  const [comfyRife, setComfyRife] = useState(true);
  const [comfyVidUpscale, setComfyVidUpscale] = useState(false);
  const [comfyVideoLora, setComfyVideoLora] = useState("none");
  const [comfyVideoLoraStrength, setComfyVideoLoraStrength] = useState(0.8);
  const [comfyVideoLoraPass, setComfyVideoLoraPass] = useState<"high" | "low" | "both">("high");
  const [comfyAudioMode, setComfyAudioMode] = useState<"none" | "ambient">("none");
  const [comfyAudioPrompt, setComfyAudioPrompt] = useState("");

  // Shared seed (empty = random)
  const [globalSeed, setGlobalSeed] = useState("");

  // Z-Image settings
  const [zimageWidth, setZimageWidth] = useState(1024);
  const [zimageHeight, setZimageHeight] = useState(1024);
  const [zimageLora, setZimageLora] = useState("none");
  const [zimageLoraStrength, setZimageLoraStrength] = useState(1.0);

  // LongLook settings
  const [longLookEnabled, setLongLookEnabled] = useState(false);
  const [longLookSeqCount, setLongLookSeqCount] = useState(2);
  const [longLookFrameCount, setLongLookFrameCount] = useState(81);
  const [longLookMotionScale, setLongLookMotionScale] = useState(1.5);

  // Fetch ComfyUI models on mount
  React.useEffect(() => {
    if (auth.isAuthenticated) fetchComfyModels();
  }, [auth.isAuthenticated, fetchComfyModels]);

  // Auto-select first checkpoint when models load
  React.useEffect(() => {
    if (comfyModels.checkpoints.length > 0 && !comfyCheckpoint) {
      setComfyCheckpoint(comfyModels.checkpoints[0]);
    }
  }, [comfyModels.checkpoints, comfyCheckpoint]);

  // Legal & guide dialog state
  const [tosOpen, setTosOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => !localStorage.getItem("how-to-use-seen"));
  const [apiKeySet, setApiKeySet] = useState(() => hasApiKey());

  // Auto-switch to credits mode when user logs in without a BYOK key
  const canUseCredits = auth.isAuthenticated && creditsHook.enabled;
  React.useEffect(() => {
    if (canUseCredits && !apiKeySet && apiMode === "byok") {
      setApiMode("credits");
    }
  }, [canUseCredits, apiKeySet, apiMode, setApiMode]);
  const effectiveApiMode = apiMode;

  const handleSaveApiKey = useCallback((key: string) => {
    setApiKeyRaw(key);
    setApiKeySet(true);
  }, [setApiKeyRaw]);

  const handleClearApiKey = useCallback(() => {
    clearApiKeyRaw();
    setApiKeySet(false);
  }, [clearApiKeyRaw]);

  const handleSelectPrompt = useCallback((prompt: string) => {
    setActivePrompt(prompt);
  }, []);

  const handleEditImage = useCallback((imageUrl: string) => {
    setMode("edit-image");
    setActiveImageUrl(imageUrl);
    setActivePrompt("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({ title: "EDIT MODE", description: "Image loaded — enter your modification prompt." });
  }, [toast]);

  const handleAnimateImage = useCallback((imageUrl: string) => {
    setMode("image-to-video");
    setActiveImageUrl(imageUrl);
    setActivePrompt("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({ title: "ANIMATE MODE", description: "Image loaded — describe the motion to apply." });
  }, [toast]);

  const handleGltchImage2 = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let sourceBlob: Blob = file;
      const t = (file.type || "").toLowerCase();
      const n = (file.name || "").toLowerCase();
      if (t === "image/heic" || t === "image/heif" || n.endsWith(".heic") || n.endsWith(".heif")) {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        sourceBlob = Array.isArray(converted) ? converted[0] : converted;
      }
      const bitmap = await createImageBitmap(sourceBlob);
      const maxDim = 1024;
      let w = bitmap.width, h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale); h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      setGltchImage2(canvas.toDataURL("image/jpeg", 0.9));
      setGltchImage2Name(file.name.replace(/\.[^.]+$/, "") + ".jpg");
    } catch {
      toast({ title: "Image error", description: "Could not process image. Try JPG or PNG.", variant: "destructive" });
    }
  }, [toast]);

  const clearGltchImage2 = useCallback(() => {
    setGltchImage2(null);
    setGltchImage2Name("");
    if (gltchImage2Ref.current) gltchImage2Ref.current.value = "";
  }, []);

  // When a result is moved to a folder, persist to IndexedDB + update React state
  const handleMoveToFolder = useCallback(async (resultId: string, folderId: string | null) => {
    try {
      await foldersHook.moveToFolder(resultId, folderId);
      updateResultFolder(resultId, folderId);
    } catch {
      toast({ title: "FOLDER ERROR", description: "Failed to move item.", variant: "destructive" });
    }
  }, [foldersHook, updateResultFolder, toast]);

  const handleSubmit = async (data: { prompt: string; imageUrl?: string }) => {
    // Determine which engine pathway
    const isGrokEdit = mode === "edit-image" && editEngine === "grok";
    const isGltchEdit = mode === "edit-image" && editEngine === "gltch";
    const isZimage = mode === "text-to-image" && genEngine === "gltch";
    const isComfyGen = mode === "text-to-image" && genEngine === "comfy";
    const isComfyRender = mode === "text-to-video" && renderEngine === "comfy";
    const isGltchWan = mode === "image-to-video" && animateEngine === "gltch";
    const isComfyAnimate = mode === "image-to-video" && animateEngine === "comfy" && !longLookEnabled;
    const isComfyLongLook = mode === "image-to-video" && animateEngine === "comfy" && longLookEnabled;
    const isComfy = isZimage || isComfyGen || isGltchEdit || isGltchWan || isComfyRender || isComfyAnimate || isComfyLongLook;
    // Grok edit in BYOK mode uses the user's own API key directly — no credits needed
    const isGrokEditByok = isGrokEdit && effectiveApiMode === "byok" && apiKeySet;
    const isQueued = isGrokEdit || isGltchEdit || isComfy;

    // Check access: need either API key (BYOK) or credits
    if (!isQueued && effectiveApiMode === "byok" && !apiKeySet) {
      toast({
        title: "API KEY REQUIRED",
        description: "Enter your xAI API key in Settings, or switch to CREDITS mode.",
        variant: "destructive",
      });
      return;
    }

    // Grok edit in BYOK mode — just need an API key, no auth/credits
    if (isGrokEditByok) {
      // Skip auth and credit checks — falls through to the queued job section below
    } else if (isQueued) {
      // All other queued jobs require auth (server-side processing)
      if (!auth.isAuthenticated) {
        toast({
          title: "ACCOUNT REQUIRED",
          description: "GLTCH & ComfyUI engines run on our servers and require an account. Sign in or switch to the GROK engine for BYOK mode.",
          variant: "destructive",
        });
        return;
      }
    }

    if ((effectiveApiMode === "credits" || isQueued) && !isGrokEditByok && !adminBypass) {
      if (!auth.isAuthenticated) {
        toast({ title: "ACCESS DENIED", description: "Sign in to use credits.", variant: "destructive" });
        return;
      }

      // Calculate cost
      let cost: number;
      if (isGrokEdit) {
        cost = calculateCreditCost(grokPro ? "edit-image-pro" : "edit-image", settings.count);
      } else if (isGltchEdit) {
        cost = calculateCreditCost(comfyEditUpscale ? "comfy-image-hd" : "comfy-image");
      } else if (isZimage || isComfyGen) {
        cost = calculateCreditCost("comfy-image");
      } else if (isComfyLongLook) {
        cost = calculateCreditCost("comfy-longlook", longLookSeqCount);
      } else if (isGltchWan) {
        cost = calculateCreditCost(comfyVidUpscale ? "comfy-video" : "comfy-video");
      } else if (isComfyRender || isComfyAnimate) {
        cost = calculateCreditCost("comfy-video");
      } else {
        const isImageMode = mode === "text-to-image" || mode === "edit-image";
        const imageCount = isImageMode ? settings.count : 1;
        const videoDuration = (mode === "text-to-video" || mode === "image-to-video" || mode === "edit-video") ? videoSettings.duration : 0;
        const creditMode = isImageMode && grokPro ? (mode === "text-to-image" ? "text-to-image-pro" : "edit-image-pro") as CreditMode : mode;
        cost = calculateCreditCost(creditMode, imageCount, videoDuration);
      }

      if (!creditsHook.hasEnoughCredits(cost)) {
        toast({
          title: "INSUFFICIENT CREDITS",
          description: `This requires ${cost} credit${cost !== 1 ? "s" : ""}. Purchase more to continue.`,
          variant: "destructive",
        });
        return;
      }
    }

    addEntry(data.prompt, mode);
    setActivePrompt("");

    // ── Queued jobs (fire-and-forget with optimistic credit deduction) ──
    if (isQueued) {
      // Deduct credits optimistically before firing the job (skip for BYOK grok edit)
      if (!adminBypass && !isGrokEditByok) {
        let cost: number;
        if (isGrokEdit) cost = calculateCreditCost(grokPro ? "edit-image-pro" : "edit-image", settings.count);
        else if (isGltchEdit) cost = calculateCreditCost(comfyEditUpscale ? "comfy-image-hd" : "comfy-image");
        else if (isGltchWan) cost = calculateCreditCost("comfy-video");
        else if (isZimage || isComfyGen) cost = calculateCreditCost("comfy-image");
        else if (isComfyLongLook) cost = calculateCreditCost("comfy-longlook", longLookSeqCount);
        else cost = calculateCreditCost("comfy-video");
        creditsHook.deductCreditsLocally(cost);
        setTimeout(() => creditsHook.refreshCredits(), 5000);
      }

      try {
        if (isGrokEdit) {
          grokEditQueued({
            prompt: data.prompt,
            image_url: data.imageUrl!,
            settings,
            pro: grokPro,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isGltchEdit) {
          const imageBase64 = data.imageUrl!.startsWith("data:")
            ? data.imageUrl!
            : await urlToBase64(data.imageUrl!);
          const round8 = (v: number) => Math.round(v / 8) * 8;
          let w: number, h: number;
          if (comfyWidth > 0 && comfyHeight > 0) {
            w = comfyWidth;
            h = comfyHeight;
          } else {
            const dim = await getImageDimensions(imageBase64);
            const maxDim = 1024;
            w = dim.width;
            h = dim.height;
            if (w > maxDim || h > maxDim) {
              const scale = maxDim / Math.max(w, h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
          }
          const parsedSeed = globalSeed ? Number(globalSeed) : undefined;
          comfyEdit({
            prompt: data.prompt,
            negativePrompt: comfyNegPrompt || undefined,
            imageBase64,
            imageBase64_2: gltchImage2 || undefined,
            imageFilename2: gltchImage2Name || undefined,
            width: round8(Math.max(256, w)),
            height: round8(Math.max(256, h)),
            steps: comfySteps,
            cfg: comfyCfg,
            seed: parsedSeed,
            loras: qwenLoraStack.filter(l => l.name !== "none"),
            upscale: comfyEditUpscale,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isZimage) {
          const parsedSeed = globalSeed ? Number(globalSeed) : undefined;
          comfyGenerate({
            prompt: data.prompt,
            workflow: "zimage",
            width: zimageWidth,
            height: zimageHeight,
            steps: 8,
            cfg: 1,
            seed: parsedSeed,
            lora: zimageLora !== "none" ? zimageLora : undefined,
            loraStrength: zimageLoraStrength,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isComfyGen) {
          const parsedSeed = globalSeed ? Number(globalSeed) : undefined;
          comfyGenerate({
            prompt: data.prompt,
            negativePrompt: comfyNegPrompt || undefined,
            checkpoint: comfyCheckpoint,
            lora: comfyLora !== "none" ? comfyLora : undefined,
            loraStrength: comfyLoraStrength,
            width: comfyWidth,
            height: comfyHeight,
            steps: comfySteps,
            cfg: comfyCfg,
            seed: parsedSeed,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isComfyRender) {
          comfyTextToVideo({
            prompt: data.prompt,
            negativePrompt: comfyNegPrompt || undefined,
            checkpoint: comfyCheckpoint,
            width: comfyWidth,
            height: comfyHeight,
            steps: comfySteps,
            cfg: comfyCfg,
            frameCount: comfyFrameCount,
            useRife: comfyRife,
            videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
            videoLoraStrength: comfyVideoLoraStrength,
            videoLoraPass: comfyVideoLoraPass,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isComfyLongLook) {
          const imageBase64 = data.imageUrl?.startsWith("data:")
            ? data.imageUrl
            : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
          if (!imageBase64) throw new Error("Image is required for LongLook");
          const dim = await getImageDimensions(imageBase64);
          const round8 = (v: number) => Math.round(v / 8) * 8;
          const maxDim = 1024;
          let w = dim.width, h = dim.height;
          if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          const parsedSeedLL = globalSeed ? Number(globalSeed) : undefined;
          comfyLongLook({
            prompt: data.prompt,
            negativePrompt: comfyNegPrompt || undefined,
            imageBase64,
            width: round8(Math.max(256, w)),
            height: round8(Math.max(256, h)),
            sequenceCount: longLookSeqCount,
            frameCount: longLookFrameCount,
            steps: comfySteps,
            cfg: comfyCfg,
            seed: parsedSeedLL,
            motionScale: longLookMotionScale,
            useRife: comfyRife,
            useUpscale: comfyVidUpscale,
            videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
            videoLoraStrength: comfyVideoLoraStrength,
            videoLoraPass: comfyVideoLoraPass,
            audioMode: comfyAudioMode,
            audioPrompt: comfyAudioPrompt || undefined,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isGltchWan) {
          const imageBase64 = data.imageUrl?.startsWith("data:")
            ? data.imageUrl
            : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
          if (!imageBase64) throw new Error("Image is required for GLTCH WAN");
          const parsedSeedWan = globalSeed ? Number(globalSeed) : undefined;
          comfyVideo({
            prompt: data.prompt,
            negativePrompt: comfyNegPrompt || undefined,
            imageBase64,
            width: 832,
            height: 832,
            frameCount: comfyFrameCount,
            steps: comfySteps,
            cfg: comfyCfg,
            seed: parsedSeedWan,
            useUpscale: comfyVidUpscale,
            workflow: "gltch-wan",
            resolution: 832,
            videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
            videoLoraStrength: comfyVideoLoraStrength,
            videoLoraPass: comfyVideoLoraPass,
            audioMode: comfyAudioMode,
            audioPrompt: comfyAudioPrompt || undefined,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        } else if (isComfyAnimate) {
          const imageBase64 = data.imageUrl?.startsWith("data:")
            ? data.imageUrl
            : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
          if (!imageBase64) throw new Error("Image is required for animation");
          const dim = await getImageDimensions(imageBase64);
          const round8 = (v: number) => Math.round(v / 8) * 8;
          const maxDim = 1024;
          let w = dim.width, h = dim.height;
          if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          const parsedSeedAnim = globalSeed ? Number(globalSeed) : undefined;
          comfyVideo({
            prompt: data.prompt,
            negativePrompt: comfyNegPrompt || undefined,
            imageBase64,
            width: round8(Math.max(256, w)),
            height: round8(Math.max(256, h)),
            frameCount: comfyFrameCount,
            steps: comfySteps,
            cfg: comfyCfg,
            seed: parsedSeedAnim,
            useRife: comfyRife,
            useUpscale: comfyVidUpscale,
            videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
            videoLoraStrength: comfyVideoLoraStrength,
            videoLoraPass: comfyVideoLoraPass,
            audioMode: comfyAudioMode,
            audioPrompt: comfyAudioPrompt || undefined,
            ...(adminTestCredits ? { testCredits: true } : {}),
          });
        }
        toast({ title: "JOB QUEUED", description: "Generation started — you can queue more." });
      } catch (err: any) {
        toast({ title: "SYSTEM_ERROR", description: err.message || "Failed to queue job.", variant: "destructive" });
      }
      return;
    }

    // ── Grok (blocking) ────────────────────────────────────────────────
    try {
      switch (mode) {
        case "text-to-image":
          await generateImage({ prompt: data.prompt, settings, pro: grokPro, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
        case "text-to-video":
          await generateVideo({ prompt: data.prompt, videoSettings, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
        case "image-to-video":
          await generateVideo({ prompt: data.prompt, image_url: data.imageUrl, videoSettings, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
        case "edit-video":
          await editVideo({ prompt: data.prompt, video_url: data.imageUrl!, ...(adminTestCredits ? { testCredits: true } : {}) });
          break;
      }

      // Optimistically deduct credits on success (admin bypass skips deduction)
      if (effectiveApiMode === "credits" && !adminBypass) {
        const isImageMode = mode === "text-to-image" || mode === "edit-image";
        const imageCount = isImageMode ? settings.count : 1;
        const videoDuration = (mode === "text-to-video" || mode === "image-to-video" || mode === "edit-video") ? videoSettings.duration : 0;
        const creditMode = isImageMode && grokPro ? (mode === "text-to-image" ? "text-to-image-pro" : "edit-image-pro") as CreditMode : mode;
        const cost = calculateCreditCost(creditMode, imageCount, videoDuration);
        creditsHook.deductCreditsLocally(cost);
        setTimeout(() => creditsHook.refreshCredits(), 2000);
      }

      toast({
        title: "RENDER COMPLETE",
        description: "Output generated successfully.",
      });
    } catch (err: any) {
      const msg = err.message || "Generation failed.";
      const lines = msg.split("\n").filter((l: string) => l.trim());
      toast({
        title: "SYSTEM_ERROR",
        description: lines[0],
        variant: "destructive",
        duration: lines.length > 1 ? 12000 : 5000,
      });
      if (lines.length > 1) {
        setTimeout(() => {
          toast({
            title: "HINT",
            description: lines.slice(1).join(" "),
            duration: 15000,
          });
        }, 500);
      }
    }
  };

  return (
    <CyberLayout>
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* Header with Orb */}
        <header className="text-center space-y-2 animate-slide-up">
          {/* Grok Orb — lazy-loaded (Three.js) */}
          <div className="w-32 h-32 sm:w-48 sm:h-48 md:w-64 md:h-64 mx-auto">
            <Suspense fallback={<div className="w-full h-full rounded-full bg-primary/5 animate-pulse" />}>
              <GrokOrb isGenerating={isLoading} />
            </Suspense>
          </div>

          <GlitchText
            text="GROK_RUNNER"
            as="h1"
            className="font-orbitron text-2xl sm:text-3xl md:text-5xl font-black tracking-wider neon-text-cyan"
            glitchIntensity="medium"
          />
          <p className="font-mono-share text-xs sm:text-sm text-muted-foreground animate-flicker">
            <span className="text-primary/50">$</span> xAI Neural Rendering Interface // v2.0
            <span className="inline-block w-2 h-4 bg-primary/70 ml-1 animate-pulse align-middle" />
          </p>

          {/* Status bar */}
          <div className="flex items-center justify-center gap-2 sm:gap-4 font-mono-share text-[9px] sm:text-[10px] text-muted-foreground/50 pt-2 flex-wrap">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              SYS_ONLINE
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"
                }`}
            />

            {/* API Mode toggle: BYOK vs Credits */}
            <div className="flex items-center bg-card/60 border border-border/50 rounded overflow-hidden">
              <button
                onClick={() => setApiMode("byok")}
                className={`flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-mono-share transition-colors ${effectiveApiMode === "byok"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
                  }`}
              >
                <Key className="w-2.5 h-2.5" />
                BYOK
              </button>
              {canUseCredits && (
                <button
                  onClick={() => setApiMode("credits")}
                  className={`flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-mono-share transition-colors ${effectiveApiMode === "credits"
                    ? "bg-secondary/20 text-secondary"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                    }`}
                >
                  <Coins className="w-2.5 h-2.5" />
                  CREDITS
                </button>
              )}
            </div>

            {/* BYOK: API key dialog */}
            {effectiveApiMode === "byok" && (
              <ApiKeyDialog
                hasKey={apiKeySet}
                onSave={handleSaveApiKey}
                onClear={handleClearApiKey}
              />
            )}

            {/* Credits: balance display */}
            {effectiveApiMode === "credits" && canUseCredits && (
              <CreditDisplay
                totalCredits={creditsHook.totalCredits}
                subCredits={creditsHook.subCredits}
                packCredits={creditsHook.packCredits}
                subscriptionTier={creditsHook.subscriptionTier}
                subscriptionRenewsAt={creditsHook.subscriptionRenewsAt}
                subscriptionCancelAt={creditsHook.subscriptionCancelAt}
                loading={creditsHook.loading}
                purchasing={creditsHook.purchasing}
                purchaseError={creditsHook.purchaseError}
                clearPurchaseError={creditsHook.clearPurchaseError}
                packages={creditsHook.packages}
                subscriptionTiers={creditsHook.subscriptionTiers}
                onPurchase={creditsHook.purchaseCredits}
                onSubscribe={creditsHook.subscribeToPlan}
                onManageSubscription={creditsHook.manageSubscription}
                onPayPalSuccess={creditsHook.refreshCredits}
              />
            )}

            {/* Admin: test credit spending toggle */}
            {isAdmin && (
              <button
                onClick={() => setAdminTestCredits(prev => !prev)}
                className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${adminTestCredits
                  ? "border-yellow-500/60 bg-yellow-500/20 text-yellow-300"
                  : "border-white/10 bg-white/5 text-white/40 hover:text-white/60"
                  }`}
                title={adminTestCredits ? "Credits WILL be deducted (testing mode)" : "Credits are bypassed (admin mode)"}
              >
                {adminTestCredits ? "TEST CR: ON" : "TEST CR: OFF"}
              </button>
            )}

            {/* Auth: login/logout */}
            {auth.enabled && (
              <AuthDialog
                isAuthenticated={auth.isAuthenticated}
                userEmail={auth.user?.email}
                onSignIn={auth.signIn}
                onSignUp={auth.signUp}
                onSignOut={auth.signOut}
                pendingVerificationEmail={auth.pendingVerificationEmail}
                onVerify={auth.verifyEmail}
                onResendCode={auth.resendCode}
                onCancelVerification={auth.cancelVerification}
                onForgotPassword={auth.forgotPassword}
                onResetPassword={auth.resetPassword}
                onDeleteAccount={auth.deleteAccount}
              />
            )}
          </div>
        </header>

        {/* Announcements */}
        {visibleAnnouncements.length > 0 && (
          <div className="space-y-2 mb-4 animate-slide-up">
            {visibleAnnouncements.map(a => (
              <div
                key={a.id}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded border font-mono-share text-[10px] ${a.type === "warning"
                  ? "bg-amber-500/5 border-amber-500/30 text-amber-300"
                  : a.type === "success"
                    ? "bg-green-500/5 border-green-500/30 text-green-300"
                    : "bg-secondary/5 border-secondary/30 text-secondary"
                  }`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
                  {a.message}
                </span>
                <button
                  onClick={() => dismissAnnouncement(a.id)}
                  className="text-current/50 hover:text-current transition-colors flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Mode selector */}
        <section className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono-share text-primary/40 text-xs">❯</span>
            <GlitchText
              text="SELECT_MODE"
              className="font-orbitron text-[10px] tracking-widest text-muted-foreground"
              glitchIntensity="low"
            />
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <ModeSelector activeMode={mode} onModeChange={(m) => { setMode(m); setActiveImageUrl(""); }} isAuthenticated={auth.isAuthenticated} />
        </section>

        {/* Prompt form — Terminal block */}
        <section
          className="relative border border-border rounded bg-card/40 backdrop-blur-sm animate-slide-up overflow-hidden"
          style={{ animationDelay: "200ms" }}
        >
          {/* Terminal title bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-card/60">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-neon-red/60" />
              <div className="w-2 h-2 rounded-full bg-neon-yellow/60" />
              <div className="w-2 h-2 rounded-full bg-primary/60" />
            </div>
            <div className="flex-1 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"
                }`} />
              <GlitchText
                text="INPUT_TERMINAL"
                className="font-orbitron text-[10px] tracking-wider text-muted-foreground"
                glitchIntensity="low"
              />
            </div>
            <span className="font-mono-share text-[9px] text-muted-foreground/30">
              pid:4207
            </span>
          </div>

          {/* Terminal body */}
          <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
            {/* Boot messages */}
            <div className="font-mono-share text-[10px] text-muted-foreground/30 space-y-0.5">
              <div><span className="text-primary/40">[ok]</span> neural_link initialized</div>
              <div><span className="text-primary/40">[ok]</span> grok-2-image-gen loaded</div>
              <div><span className="text-primary/40">[ok]</span> awaiting input<span className="inline-block w-1.5 h-3 bg-muted-foreground/20 ml-1 animate-pulse align-middle" /></div>
            </div>

            <div className="h-px bg-border/30" />

            <SettingsPanel settings={settings} videoSettings={videoSettings} onChange={handleSettingsChange} onVideoChange={handleVideoSettingsChange} mode={mode} />

            {/* Engine selector — shows in edit-image mode */}
            {mode === "edit-image" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditEngine("grok")}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${editEngine === "grok"
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${editEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-amber-400/80 border-amber-500/30 bg-amber-500/10">BYOK ONLY</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={editEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>
                        {grokPro ? `${settings.count * 4} cr` : `${settings.count * 2} cr`}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditEngine("gltch"); fetchComfyModels(); }}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${editEngine === "gltch"
                        ? "border-secondary neon-border bg-secondary/5"
                        : "border-border bg-card/30 hover:border-secondary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${editEngine === "gltch" ? "text-secondary" : "text-foreground"}`}>
                      GLTCH
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-red-400/80 border-red-500/30 bg-red-500/10 animate-pulse">RAW</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>Edit + LoRA</span>
                      <span className={editEngine === "gltch" ? "text-secondary/70" : "text-muted-foreground/50"}>
                        {comfyEditUpscale ? "2" : "1"} cr
                      </span>
                    </div>
                  </button>
                </div>

                {/* PRO quality toggle — Grok edit */}
                {editEngine === "grok" && (
                  <button
                    type="button"
                    onClick={() => setGrokPro(!grokPro)}
                    className={`
                      w-full flex items-center justify-between px-3 py-2 border rounded
                      font-mono-share text-[10px] transition-all duration-200
                      ${grokPro
                        ? "border-amber-500/50 bg-amber-500/5 text-amber-300"
                        : "border-border bg-card/30 text-muted-foreground hover:border-amber-500/30"
                      }
                    `}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px]
                        ${grokPro ? "border-amber-500 bg-amber-500 text-white" : "border-muted-foreground/30"}
                      `}>
                        {grokPro && "✓"}
                      </span>
                      PRO QUALITY (enhanced detail)
                    </span>
                    <span className="text-[9px]">
                      {grokPro ? "4 cr/img" : "+2 cr/img"}
                    </span>
                  </button>
                )}

                {/* GLTCH edit controls — LoRA selector + upscale */}
                {editEngine === "gltch" && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/5 border border-secondary/20 rounded">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                      <span className="font-mono-share text-[9px] text-secondary/70">
                        {comfyEditUpscale ? "2" : "1"} cr/edit — Qwen2.5 VL Edit + LoRA
                      </span>
                    </div>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">OUTPUT SIZE</label>
                      <div className="grid grid-cols-4 gap-1">
                        {([
                          [0, 0, "AUTO"],
                          [1024, 1024, "1:1"],
                          [768, 1024, "3:4"],
                          [1024, 768, "4:3"],
                          [768, 1360, "9:16"],
                          [1360, 768, "16:9"],
                          [832, 1216, "2:3"],
                          [1216, 832, "3:2"],
                        ] as [number, number, string][]).map(([w, h, label]) => (
                          <button key={`qe-${w}x${h}`} type="button"
                            onClick={() => { setComfyWidth(w); setComfyHeight(h); }}
                            className={`px-1.5 py-1 rounded text-center font-mono-share text-[9px] border transition-all
                              ${comfyWidth === w && comfyHeight === h
                                ? "border-purple-500 bg-purple-500/10 text-purple-400"
                                : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/40"
                              }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="font-mono-share text-[8px] text-muted-foreground/50 mt-1">AUTO = match input image</p>
                    </div>
                    {comfyModels.qwenLoras.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="font-mono-share text-[9px] text-muted-foreground">LORA STACK</label>
                          {qwenLoraStack.length < comfyModels.qwenLoras.length && (
                            <button
                              type="button"
                              onClick={() => setQwenLoraStack(prev => [...prev, { name: "none", strengthModel: 0.8, strengthClip: 0.8 }])}
                              className="font-mono-share text-[9px] text-purple-400 hover:text-purple-300 transition-colors"
                            >
                              + ADD LORA
                            </button>
                          )}
                        </div>
                        {qwenLoraStack.length === 0 && (
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const skin = comfyModels.qwenLoras.find(l => l.toLowerCase().includes("skin"));
                                if (skin) setQwenLoraStack([{ name: skin, strengthModel: 1, strengthClip: 1 }]);
                              }}
                              className="w-full p-2 border border-cyan-500/30 bg-cyan-500/5 rounded text-center font-mono-share text-[9px] text-cyan-400 hover:border-cyan-500/50 hover:bg-cyan-500/10 transition-all"
                            >
                              PERFECTION (BETA)
                            </button>
                            <button
                              type="button"
                              onClick={() => setQwenLoraStack([{ name: "none", strengthModel: 0.8, strengthClip: 0.8 }])}
                              className="w-full p-2 border border-dashed border-purple-500/30 rounded text-center font-mono-share text-[9px] text-purple-400/60 hover:border-purple-500/50 hover:text-purple-400 transition-colors"
                            >
                              + ADD LORA MANUALLY
                            </button>
                          </div>
                        )}
                        {qwenLoraStack.map((entry, idx) => {
                          const usedNames = qwenLoraStack.filter((_, i) => i !== idx).map(l => l.name);
                          const available = comfyModels.qwenLoras.filter(l => !usedNames.includes(l));
                          return (
                            <div key={idx} className="space-y-1 p-2 bg-card/30 border border-purple-500/10 rounded">
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={entry.name}
                                  onChange={(e) => {
                                    if (isNsfwLora(e.target.value) && !comfyModels.xrgeHolder && e.target.value !== "none") return;
                                    setQwenLoraStack(prev => prev.map((l, i) => i === idx ? { ...l, name: e.target.value } : l));
                                  }}
                                  className="flex-1 bg-card/50 border border-border rounded px-2 py-1 font-mono-share text-[10px] text-foreground"
                                >
                                  <option value="none">Select LoRA...</option>
                                  {available.map(l => (
                                    <option key={l} value={l}
                                      disabled={isNsfwLora(l) && !comfyModels.xrgeHolder}
                                      style={isNsfwLora(l) && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                                      {isNsfwLora(l) && !comfyModels.xrgeHolder ? "🔒 " : ""}{l.replace(/\.(safetensors|ckpt|pt)$/i, "")}
                                    </option>
                                  ))}
                                  {entry.name !== "none" && !available.includes(entry.name) && (
                                    <option value={entry.name}>{entry.name.replace(/\.(safetensors|ckpt|pt)$/i, "")}</option>
                                  )}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => setQwenLoraStack(prev => prev.filter((_, i) => i !== idx))}
                                  className="text-red-400/60 hover:text-red-400 transition-colors p-0.5"
                                  title="Remove"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                              {entry.name !== "none" && (
                                <div className="space-y-1">
                                  <div className="space-y-0.5">
                                    <div className="flex items-center justify-between">
                                      <label className="font-mono-share text-[8px] text-muted-foreground">MODEL</label>
                                      <span className="font-mono-share text-[8px] text-purple-400">{entry.strengthModel.toFixed(2)}</span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0" max="1.5" step="0.05"
                                      value={entry.strengthModel}
                                      onChange={(e) => setQwenLoraStack(prev => prev.map((l, i) => i === idx ? { ...l, strengthModel: Number(e.target.value) } : l))}
                                      className="w-full accent-purple-500"
                                    />
                                  </div>
                                  <div className="space-y-0.5">
                                    <div className="flex items-center justify-between">
                                      <label className="font-mono-share text-[8px] text-muted-foreground">CLIP</label>
                                      <span className="font-mono-share text-[8px] text-cyan-400">{entry.strengthClip.toFixed(2)}</span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0" max="1.5" step="0.01"
                                      value={entry.strengthClip}
                                      onChange={(e) => setQwenLoraStack(prev => prev.map((l, i) => i === idx ? { ...l, strengthClip: Number(e.target.value) } : l))}
                                      className="w-full accent-cyan-500"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!comfyModels.xrgeHolder && comfyModels.qwenLoras.some(isNsfwLora) && (
                          <p className="mt-1 font-mono-share text-[8px] text-pink-400/70">
                            🔒 NSFW LoRAs unlocked for <span className="text-pink-400">$XRGE</span> holders
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setComfyEditUpscale(!comfyEditUpscale)}
                      className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${comfyEditUpscale
                        ? "border-purple-500/50 bg-purple-500/5 text-purple-300"
                        : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/30"
                        }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${comfyEditUpscale ? "border-purple-500 bg-purple-500 text-white" : "border-muted-foreground/30"
                          }`}>
                          {comfyEditUpscale ? "✓" : ""}
                        </span>
                        HD UPSCALE (2x)
                      </span>
                      <span className={`text-[8px] ${comfyEditUpscale ? "text-yellow-400" : "text-muted-foreground/50"}`}>
                        +1 cr
                      </span>
                    </button>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground mb-1 block">SECOND IMAGE (OPTIONAL)</label>
                      {gltchImage2 ? (
                        <div className="relative">
                          <img
                            src={gltchImage2}
                            alt="Reference 2"
                            className="w-full max-h-36 object-contain rounded border border-purple-500/20 bg-black/60"
                          />
                          <button
                            type="button"
                            onClick={clearGltchImage2}
                            className="absolute top-1 right-1 p-1 bg-black/80 rounded-full text-red-400 hover:text-red-300"
                            title="Remove second image"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => gltchImage2Ref.current?.click()}
                          className="w-full flex items-center justify-center gap-2 px-3 py-3 bg-black/60 border border-dashed border-purple-500/30 rounded text-xs font-mono-share text-purple-400/60 hover:border-purple-400/50 hover:text-purple-300 transition-colors"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Add reference image
                        </button>
                      )}
                      <input
                        ref={gltchImage2Ref}
                        type="file"
                        accept="image/*"
                        onChange={handleGltchImage2}
                        className="hidden"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Engine selector — GENERATE mode */}
            {mode === "text-to-image" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setGenEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${genEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${genEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-amber-400/80 border-amber-500/30 bg-amber-500/10">BYOK ONLY</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={genEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>{grokPro ? settings.count * 3 : settings.count} cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setGenEngine("gltch")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${genEngine === "gltch" ? "border-secondary neon-border bg-secondary/5" : "border-border bg-card/30 hover:border-secondary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${genEngine === "gltch" ? "text-secondary" : "text-foreground"}`}>
                      GLTCH
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-red-400/80 border-red-500/30 bg-red-500/10 animate-pulse">RAW</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>Z-Image Turbo</span>
                      <span className={genEngine === "gltch" ? "text-secondary/70" : "text-muted-foreground/50"}>1 cr</span>
                    </div>
                  </button>
                </div>
                {genEngine === "gltch" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/5 border border-secondary/20 rounded">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                      <span className="font-mono-share text-[9px] text-secondary/70">
                        1 cr/img — Z-Image Turbo 6B · 8 steps · {zimageWidth}×{zimageHeight}
                      </span>
                    </div>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">DIMENSIONS</label>
                      <div className="grid grid-cols-4 gap-1">
                        {([
                          [1024, 1024, "1:1"],
                          [768, 1024, "3:4"],
                          [1024, 768, "4:3"],
                          [768, 1360, "9:16"],
                          [1360, 768, "16:9"],
                          [832, 1216, "2:3"],
                          [1216, 832, "3:2"],
                          [512, 512, "SM"],
                        ] as [number, number, string][]).map(([w, h, label]) => (
                          <button key={`${w}x${h}`} type="button"
                            onClick={() => { setZimageWidth(w); setZimageHeight(h); }}
                            className={`px-1.5 py-1 rounded text-center font-mono-share text-[9px] border transition-all
                              ${zimageWidth === w && zimageHeight === h
                                ? "border-secondary bg-secondary/10 text-secondary"
                                : "border-border bg-card/30 text-muted-foreground hover:border-secondary/40"
                              }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {comfyModels.loras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">LORA</label>
                        <select value={zimageLora} onChange={(e) => {
                          if (isNsfwLora(e.target.value) && !comfyModels.xrgeHolder && e.target.value !== "none") return;
                          setZimageLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.loras.map((l) => (
                            <option key={l} value={l}
                              disabled={isNsfwLora(l) && !comfyModels.xrgeHolder}
                              style={isNsfwLora(l) && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {isNsfwLora(l) && !comfyModels.xrgeHolder ? "🔒 " : ""}{l.replace(/\.[^.]+$/, "")}
                            </option>
                          ))}
                        </select>
                        {!comfyModels.xrgeHolder && comfyModels.loras.some(isNsfwLora) && (
                          <p className="mt-1 font-mono-share text-[8px] text-pink-400/70">
                            🔒 NSFW LoRAs unlocked for <span className="text-pink-400">$XRGE</span> holders
                          </p>
                        )}
                        {zimageLora !== "none" && (
                          <div className="mt-1">
                            <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {zimageLoraStrength.toFixed(2)}</label>
                            <input type="range" min={0} max={2} step={0.05} value={zimageLoraStrength}
                              onChange={(e) => setZimageLoraStrength(parseFloat(e.target.value))}
                              className="w-full accent-secondary h-1" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* Comfy GENERATE settings */}
                {genEngine === "comfy" && (
                  <div className="space-y-2">
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Checkpoint</label>
                      <select value={comfyCheckpoint} onChange={(e) => setComfyCheckpoint(e.target.value)}
                        className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                        {comfyModels.checkpoints.length === 0 && <option value="">No models found</option>}
                        {comfyModels.checkpoints.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {comfyModels.loras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">LoRA (optional)</label>
                        <select value={comfyLora} onChange={(e) => {
                          if (isNsfwLora(e.target.value) && !comfyModels.xrgeHolder && e.target.value !== "none") return;
                          setComfyLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.loras.map((l) => (
                            <option key={l} value={l}
                              disabled={isNsfwLora(l) && !comfyModels.xrgeHolder}
                              style={isNsfwLora(l) && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {isNsfwLora(l) && !comfyModels.xrgeHolder ? "🔒 " : ""}{l.replace(/\.[^.]+$/, "")}
                            </option>
                          ))}
                        </select>
                        {comfyLora !== "none" && (
                          <div className="mt-1">
                            <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {comfyLoraStrength.toFixed(2)}</label>
                            <input type="range" min={0} max={1.5} step={0.05} value={comfyLoraStrength}
                              onChange={(e) => setComfyLoraStrength(Number(e.target.value))}
                              className="w-full accent-purple-500 mt-0.5" />
                          </div>
                        )}
                      </div>
                    )}
                    {/* Negative Prompt */}
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Negative Prompt</label>
                      <input type="text" value={comfyNegPrompt} onChange={(e) => setComfyNegPrompt(e.target.value)}
                        placeholder="(uses smart default if empty)"
                        className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground placeholder-muted-foreground/40" />
                    </div>
                    {/* Resolution */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">W</label>
                        <select value={comfyWidth} onChange={(e) => setComfyWidth(Number(e.target.value))}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          {[512, 768, 832, 1024, 1080, 1280, 1536].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">H</label>
                        <select value={comfyHeight} onChange={(e) => setComfyHeight(Number(e.target.value))}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          {[512, 768, 832, 1024, 1080, 1280, 1536].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    {/* Steps & CFG */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Steps: {comfySteps}</label>
                        <input type="range" min={1} max={50} value={comfySteps}
                          onChange={(e) => setComfySteps(Number(e.target.value))}
                          className="w-full accent-purple-500" />
                      </div>
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">CFG: {comfyCfg}</label>
                        <input type="range" min={0.5} max={15} step={0.5} value={comfyCfg}
                          onChange={(e) => setComfyCfg(Number(e.target.value))}
                          className="w-full accent-purple-500" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/5 border border-purple-500/20 rounded">
                      <Cpu className="w-3 h-3 text-purple-400/70" />
                      <span className="font-mono-share text-[9px] text-purple-400/70">
                        Self-hosted GPU — 1 credit per image
                      </span>
                    </div>
                  </div>
                )}

                {/* PRO quality toggle — Grok generate */}
                {genEngine === "grok" && (
                  <button
                    type="button"
                    onClick={() => setGrokPro(!grokPro)}
                    className={`
                      w-full flex items-center justify-between px-3 py-2 border rounded
                      font-mono-share text-[10px] transition-all duration-200
                      ${grokPro
                        ? "border-amber-500/50 bg-amber-500/5 text-amber-300"
                        : "border-border bg-card/30 text-muted-foreground hover:border-amber-500/30"
                      }
                    `}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px]
                        ${grokPro ? "border-amber-500 bg-amber-500 text-white" : "border-muted-foreground/30"}
                      `}>
                        {grokPro && "✓"}
                      </span>
                      PRO QUALITY (enhanced detail)
                    </span>
                    <span className="text-[9px]">
                      {grokPro ? "3 cr/img" : "+2 cr/img"}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Engine selector — RENDER (text-to-video) mode */}
            {mode === "text-to-video" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRenderEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${renderEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${renderEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-amber-400/80 border-amber-500/30 bg-amber-500/10">BYOK ONLY</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={renderEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>{videoSettings.duration * 2} cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setRenderEngine("comfy")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${renderEngine === "comfy" ? "border-purple-500 bg-purple-500/5 shadow-[0_0_8px_rgba(168,85,247,0.15)]" : "border-border bg-card/30 hover:border-purple-500/40"}`}>
                    <div className={`font-orbitron text-[11px] ${renderEngine === "comfy" ? "text-purple-400" : "text-foreground"}`}>COMFY</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>WAN Video</span>
                      <span className={renderEngine === "comfy" ? "text-purple-400/70" : "text-muted-foreground/50"}>3 cr</span>
                    </div>
                  </button>
                </div>
                {/* Comfy RENDER settings */}
                {renderEngine === "comfy" && (
                  <div className="space-y-2">
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Checkpoint (for start frame)</label>
                      <select value={comfyCheckpoint} onChange={(e) => setComfyCheckpoint(e.target.value)}
                        className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                        {comfyModels.checkpoints.length === 0 && <option value="">No models found</option>}
                        {comfyModels.checkpoints.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {/* Negative Prompt */}
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Negative Prompt</label>
                      <input type="text" value={comfyNegPrompt} onChange={(e) => setComfyNegPrompt(e.target.value)}
                        placeholder="(uses WAN default if empty)"
                        className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground placeholder-muted-foreground/40" />
                    </div>
                    {/* Resolution & Steps/CFG */}
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">W</label>
                        <select value={comfyWidth} onChange={(e) => setComfyWidth(Number(e.target.value))}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          {[480, 512, 640, 768, 832, 1024].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">H</label>
                        <select value={comfyHeight} onChange={(e) => setComfyHeight(Number(e.target.value))}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          {[480, 512, 640, 768, 832, 1024].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Steps: {comfySteps}</label>
                        <input type="range" min={1} max={10} value={comfySteps}
                          onChange={(e) => setComfySteps(Number(e.target.value))}
                          className="w-full accent-purple-500" />
                      </div>
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">CFG: {comfyCfg}</label>
                        <input type="range" min={0.5} max={15} step={0.5} value={comfyCfg}
                          onChange={(e) => setComfyCfg(Number(e.target.value))}
                          className="w-full accent-purple-500" />
                      </div>
                    </div>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Duration</label>
                      <div className="flex flex-wrap gap-1.5">
                        {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }, { label: "~10s", value: 161 }, { label: "~15s", value: 241 }].map((p) => (
                          <button key={p.value} type="button" onClick={() => setComfyFrameCount(p.value)}
                            className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyFrameCount === p.value ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => setComfyRife(!comfyRife)}
                      className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${comfyRife ? "border-purple-500/50 bg-purple-500/5 text-purple-300" : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/30"}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${comfyRife ? "border-purple-500 bg-purple-500 text-white" : "border-muted-foreground/30"}`}>
                          {comfyRife && "✓"}
                        </span>
                        RIFE 2x interpolation (smoother)
                      </span>
                    </button>
                    {comfyModels.videoLoras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Video LoRA (optional)</label>
                        <select value={comfyVideoLora} onChange={(e) => {
                          const entry = comfyModels.videoLoras.find(v => v.name === e.target.value);
                          if (entry?.nsfw && !comfyModels.xrgeHolder) return;
                          setComfyVideoLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.videoLoras.map((entry) => (
                            <option key={entry.name} value={entry.name}
                              disabled={!!entry.nsfw && !comfyModels.xrgeHolder}
                              style={entry.nsfw && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {entry.nsfw && !comfyModels.xrgeHolder ? `🔒 ${entry.name.replace(/_/g, " ")}` : entry.name.replace(/_/g, " ")}{entry.high && entry.low ? " (paired)" : ""}
                            </option>
                          ))}
                        </select>
                        {!comfyModels.xrgeHolder && comfyModels.videoLoras.some(v => v.nsfw) && (
                          <p className="mt-1 font-mono-share text-[8px] text-pink-400/70">
                            🔒 NSFW LoRAs unlocked for <span className="text-pink-400">$XRGE</span> holders — purchase credits with $XRGE to unlock
                          </p>
                        )}
                        {comfyVideoLora !== "none" && (() => {
                          const selected = comfyModels.videoLoras.find((e) => e.name === comfyVideoLora);
                          const isPaired = selected?.high && selected?.low;
                          return (
                            <div className="mt-1.5 space-y-1.5">
                              <div>
                                <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {comfyVideoLoraStrength.toFixed(2)}</label>
                                <input type="range" min={0} max={2} step={0.05} value={comfyVideoLoraStrength}
                                  onChange={(e) => setComfyVideoLoraStrength(Number(e.target.value))}
                                  className="w-full accent-purple-500 mt-0.5" />
                              </div>
                              {isPaired ? (
                                <div className="flex items-center gap-2 px-2 py-1 bg-purple-500/5 border border-purple-500/20 rounded">
                                  <span className="font-mono-share text-[9px] text-purple-400/70">
                                    Auto-paired: high + low noise files detected
                                  </span>
                                </div>
                              ) : (
                                <div>
                                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Apply to pass</label>
                                  <div className="flex gap-1.5">
                                    {(["high", "low", "both"] as const).map((p) => (
                                      <button key={p} type="button" onClick={() => setComfyVideoLoraPass(p)}
                                        className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyVideoLoraPass === p ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                                        {p === "high" ? "High Noise" : p === "low" ? "Low Noise" : "Both"}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/5 border border-purple-500/20 rounded">
                      <Film className="w-3 h-3 text-purple-400/70" />
                      <span className="font-mono-share text-[9px] text-purple-400/70">
                        Auto-generates start frame, then animates — 3 cr flat
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Engine selector — ANIMATE (image-to-video) mode */}
            {mode === "image-to-video" && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAnimateEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${animateEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${animateEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-amber-400/80 border-amber-500/30 bg-amber-500/10">BYOK ONLY</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={animateEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>{videoSettings.duration * 2} cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setAnimateEngine("gltch")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${animateEngine === "gltch" ? "border-secondary neon-border bg-secondary/5" : "border-border bg-card/30 hover:border-secondary/40"}`}>
                    <div className={`font-orbitron text-[11px] flex items-center gap-1.5 ${animateEngine === "gltch" ? "text-secondary" : "text-foreground"}`}>
                      GLTCH
                      <span className="font-mono-share text-[7px] px-1 py-px border rounded-sm tracking-widest text-red-400/80 border-red-500/30 bg-red-500/10 animate-pulse">RAW</span>
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>WAN 2.2 I2V</span>
                      <span className={animateEngine === "gltch" ? "text-secondary/70" : "text-muted-foreground/50"}>2 cr</span>
                    </div>
                  </button>
                </div>
                {/* GLTCH WAN settings */}
                {animateEngine === "gltch" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/5 border border-secondary/20 rounded">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                      <span className="font-mono-share text-[9px] text-secondary/70">
                        WAN 2.2 GGUF — Lightx2v + Pusa enhanced motions
                      </span>
                    </div>
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Duration</label>
                      <div className="flex flex-wrap gap-1.5">
                        {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }, { label: "~10s", value: 161 }, { label: "~15s", value: 241 }].map((p) => (
                          <button key={p.value} type="button" onClick={() => setComfyFrameCount(p.value)}
                            className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyFrameCount === p.value ? "bg-secondary/20 border-secondary/50 text-secondary border" : "bg-card/30 border border-border text-muted-foreground hover:border-secondary/30"}`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => setComfyVidUpscale(!comfyVidUpscale)}
                      className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${comfyVidUpscale ? "border-secondary/50 bg-secondary/5 text-secondary" : "border-border bg-card/30 text-muted-foreground hover:border-secondary/30"}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${comfyVidUpscale ? "border-secondary bg-secondary text-secondary-foreground" : "border-muted-foreground/30"}`}>
                          {comfyVidUpscale && "✓"}
                        </span>
                        HD (2x upscale + RIFE 4x @ 60fps)
                      </span>
                      <span className="text-[8px]">+2 cr</span>
                    </button>
                    {comfyModels.videoLoras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Video LoRA (optional)</label>
                        <select value={comfyVideoLora} onChange={(e) => {
                          const entry = comfyModels.videoLoras.find(v => v.name === e.target.value);
                          if (entry?.nsfw && !comfyModels.xrgeHolder) return;
                          setComfyVideoLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.videoLoras.map((entry) => (
                            <option key={entry.name} value={entry.name}
                              disabled={!!entry.nsfw && !comfyModels.xrgeHolder}
                              style={entry.nsfw && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {entry.nsfw && !comfyModels.xrgeHolder ? "🔒 " : ""}{entry.name.replace(/_/g, " ")}{entry.high && entry.low ? " (paired)" : ""}
                            </option>
                          ))}
                        </select>
                        {!comfyModels.xrgeHolder && comfyModels.videoLoras.some(v => v.nsfw) && (
                          <p className="mt-1 font-mono-share text-[8px] text-pink-400/70">
                            🔒 NSFW LoRAs unlocked for <span className="text-pink-400">$XRGE</span> holders
                          </p>
                        )}
                        {comfyVideoLora !== "none" && (() => {
                          const selected = comfyModels.videoLoras.find((e) => e.name === comfyVideoLora);
                          const isPaired = selected?.high && selected?.low;
                          return (
                            <div className="mt-1.5 space-y-1.5">
                              <div>
                                <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {comfyVideoLoraStrength.toFixed(2)}</label>
                                <input type="range" min={0} max={2} step={0.05} value={comfyVideoLoraStrength}
                                  onChange={(e) => setComfyVideoLoraStrength(Number(e.target.value))}
                                  className="w-full accent-secondary mt-0.5" />
                              </div>
                              {!isPaired && (
                                <div>
                                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Apply to pass</label>
                                  <div className="flex gap-1.5">
                                    {(["high", "low", "both"] as const).map((p) => (
                                      <button key={p} type="button" onClick={() => setComfyVideoLoraPass(p)}
                                        className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyVideoLoraPass === p ? "bg-secondary/20 border-secondary/50 text-secondary border" : "bg-card/30 border border-border text-muted-foreground hover:border-secondary/30"}`}>
                                        {p === "high" ? "High Noise" : p === "low" ? "Low Noise" : "Both"}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
                {/* Old Comfy ANIMATE settings — hidden, GLTCH replaces this */}
                {animateEngine === "comfy" && false && (
                  <div className="space-y-2">
                    <button type="button" onClick={() => setLongLookEnabled(!longLookEnabled)}
                      className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${longLookEnabled ? "border-purple-500/50 bg-purple-500/10 text-purple-300" : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/30"}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${longLookEnabled ? "border-purple-500 bg-purple-500 text-white" : "border-muted-foreground/30"}`}>
                          {longLookEnabled && "✓"}
                        </span>
                        LONGLOOK (Multi-Clip)
                      </span>
                      <span className="font-mono-share text-[8px] text-purple-400/50">GGUF</span>
                    </button>

                    {/* LongLook settings */}
                    {longLookEnabled && (
                      <div className="space-y-2 pl-2 border-l-2 border-purple-500/20">
                        <div>
                          <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Sequences</label>
                          <div className="flex gap-1.5">
                            {[1, 2, 3, 4].map((n) => (
                              <button key={n} type="button" onClick={() => setLongLookSeqCount(n)}
                                className={`px-3 py-1 rounded text-[10px] font-mono-share transition-all ${longLookSeqCount === n ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Duration per sequence</label>
                          <div className="flex flex-wrap gap-1.5">
                            {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }].map((p) => (
                              <button key={p.value} type="button" onClick={() => setLongLookFrameCount(p.value)}
                                className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${longLookFrameCount === p.value ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Motion Scale: {longLookMotionScale.toFixed(1)}x</label>
                          <input type="range" min={0.5} max={3.0} step={0.1} value={longLookMotionScale}
                            onChange={(e) => setLongLookMotionScale(Number(e.target.value))}
                            className="w-full accent-purple-500" />
                          <div className="flex justify-between text-[8px] text-muted-foreground/40 font-mono-share mt-0.5">
                            <span>Slower</span>
                            <span>1.5x optimal</span>
                            <span>Faster</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Negative Prompt */}
                    <div>
                      <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Negative Prompt</label>
                      <input type="text" value={comfyNegPrompt} onChange={(e) => setComfyNegPrompt(e.target.value)}
                        placeholder="(uses WAN default if empty)"
                        className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground placeholder-muted-foreground/40" />
                    </div>
                    {/* Standard duration (only when LongLook is off) */}
                    {!longLookEnabled && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Duration</label>
                        <div className="flex flex-wrap gap-1.5">
                          {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }, { label: "~10s", value: 161 }, { label: "~15s", value: 241 }].map((p) => (
                            <button key={p.value} type="button" onClick={() => setComfyFrameCount(p.value)}
                              className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyFrameCount === p.value ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button type="button" onClick={() => setComfyRife(!comfyRife)}
                      className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${comfyRife ? "border-purple-500/50 bg-purple-500/5 text-purple-300" : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/30"}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${comfyRife ? "border-purple-500 bg-purple-500 text-white" : "border-muted-foreground/30"}`}>
                          {comfyRife && "✓"}
                        </span>
                        RIFE 2x interpolation (smoother)
                      </span>
                    </button>
                    <button type="button" onClick={() => setComfyVidUpscale(!comfyVidUpscale)}
                      className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${comfyVidUpscale ? "border-purple-500/50 bg-purple-500/5 text-purple-300" : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/30"}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${comfyVidUpscale ? "border-purple-500 bg-purple-500 text-white" : "border-muted-foreground/30"}`}>
                          {comfyVidUpscale && "✓"}
                        </span>
                        2x Lanczos upscale
                      </span>
                    </button>
                    <button type="button" onClick={() => setComfyAudioMode(comfyAudioMode === "ambient" ? "none" : "ambient")}
                      className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${comfyAudioMode === "ambient" ? "border-cyan-500/50 bg-cyan-500/5 text-cyan-300" : "border-border bg-card/30 text-muted-foreground hover:border-cyan-500/30"}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${comfyAudioMode === "ambient" ? "border-cyan-500 bg-cyan-500 text-white" : "border-muted-foreground/30"}`}>
                          {comfyAudioMode === "ambient" && "✓"}
                        </span>
                        🔊 MMAudio (ambient sound)
                      </span>
                    </button>
                    {comfyAudioMode === "ambient" && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Audio prompt (optional — defaults to video prompt)</label>
                        <textarea
                          value={comfyAudioPrompt}
                          onChange={(e) => setComfyAudioPrompt(e.target.value)}
                          placeholder="e.g. city rain, birds chirping, footsteps..."
                          rows={2}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground resize-none"
                        />
                      </div>
                    )}
                    {comfyModels.videoLoras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Video LoRA (optional)</label>
                        <select value={comfyVideoLora} onChange={(e) => {
                          const entry = comfyModels.videoLoras.find(v => v.name === e.target.value);
                          if (entry?.nsfw && !comfyModels.xrgeHolder) return;
                          setComfyVideoLora(e.target.value);
                        }}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.videoLoras.map((entry) => (
                            <option key={entry.name} value={entry.name}
                              disabled={!!entry.nsfw && !comfyModels.xrgeHolder}
                              style={entry.nsfw && !comfyModels.xrgeHolder ? { color: '#666', fontStyle: 'italic' } : undefined}>
                              {entry.nsfw && !comfyModels.xrgeHolder ? "🔒 " : ""}{entry.name.replace(/_/g, " ")}{entry.high && entry.low ? " (paired)" : ""}
                            </option>
                          ))}
                        </select>
                        {!comfyModels.xrgeHolder && comfyModels.videoLoras.some(v => v.nsfw) && (
                          <p className="mt-1 font-mono-share text-[8px] text-pink-400/70">
                            🔒 NSFW LoRAs unlocked for <span className="text-pink-400">$XRGE</span> holders
                          </p>
                        )}
                        {comfyVideoLora !== "none" && (() => {
                          const selected = comfyModels.videoLoras.find((e) => e.name === comfyVideoLora);
                          const isPaired = selected?.high && selected?.low;
                          return (
                            <div className="mt-1.5 space-y-1.5">
                              <div>
                                <label className="font-mono-share text-[9px] text-muted-foreground/70">Strength: {comfyVideoLoraStrength.toFixed(2)}</label>
                                <input type="range" min={0} max={2} step={0.05} value={comfyVideoLoraStrength}
                                  onChange={(e) => setComfyVideoLoraStrength(Number(e.target.value))}
                                  className="w-full accent-purple-500 mt-0.5" />
                              </div>
                              {isPaired ? (
                                <div className="flex items-center gap-2 px-2 py-1 bg-purple-500/5 border border-purple-500/20 rounded">
                                  <span className="font-mono-share text-[9px] text-purple-400/70">
                                    Auto-paired: high + low noise files detected
                                  </span>
                                </div>
                              ) : (
                                <div>
                                  <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Apply to pass</label>
                                  <div className="flex gap-1.5">
                                    {(["high", "low", "both"] as const).map((p) => (
                                      <button key={p} type="button" onClick={() => setComfyVideoLoraPass(p)}
                                        className={`px-2 py-1 rounded text-[9px] font-mono-share transition-all ${comfyVideoLoraPass === p ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border" : "bg-card/30 border border-border text-muted-foreground hover:border-purple-500/30"}`}>
                                        {p === "high" ? "High Noise" : p === "low" ? "Low Noise" : "Both"}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/5 border border-purple-500/20 rounded">
                      <Film className="w-3 h-3 text-purple-400/70" />
                      <span className="font-mono-share text-[9px] text-purple-400/70">
                        {longLookEnabled
                          ? `LongLook ${longLookSeqCount} x 2${comfyAudioMode === "ambient" ? " + 1 audio" : ""} = ${longLookSeqCount * 2 + (comfyAudioMode === "ambient" ? 1 : 0)} cr`
                          : `WAN 2.2 I2V — ${comfyAudioMode === "ambient" ? "3" : "2"} credits per video`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Seed control — shared across all GLTCH/Comfy engine modes */}
            {auth.isAuthenticated && (
              (mode === "edit-image" && editEngine === "gltch") ||
              (mode === "text-to-image" && (genEngine === "comfy" || genEngine === "gltch")) ||
              mode === "animate" ||
              (mode === "image-to-video" && animateEngine === "gltch")
            ) && (
                <div className="flex items-center gap-2">
                  <label className="font-mono-share text-[9px] text-muted-foreground/70 whitespace-nowrap">SEED</label>
                  <input
                    type="text"
                    value={globalSeed}
                    onChange={(e) => setGlobalSeed(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="random"
                    className="flex-1 bg-card/60 border border-border rounded px-2 py-1 text-[10px] font-mono-share text-foreground placeholder-muted-foreground/40 max-w-[140px]"
                  />
                  {globalSeed && (
                    <button
                      type="button"
                      onClick={() => setGlobalSeed("")}
                      className="font-mono-share text-[8px] text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      CLEAR
                    </button>
                  )}
                </div>
              )}

            <PromptHistory history={history} onSelect={handleSelectPrompt} onRemove={removeEntry} onClear={clearHistory} />
            <PromptForm mode={mode} isLoading={isLoading} onSubmit={handleSubmit} settings={settings} initialPrompt={activePrompt} initialImageUrl={activeImageUrl} />
          </div>
        </section>

        {/* Error display */}
        {error && (
          <div className="border border-destructive/50 rounded overflow-hidden animate-slide-up">
            <div className="flex items-center gap-2 px-4 py-1.5 bg-destructive/10 border-b border-destructive/20">
              <span className="font-mono-share text-[10px] text-destructive">stderr</span>
            </div>
            <div className="p-4">
              <p className="font-mono-share text-sm text-destructive/80">
                <span className="text-destructive/50">error: </span>{error}
              </p>
              <button
                onClick={clearError}
                className="font-mono-share text-xs text-muted-foreground hover:text-foreground mt-2 underline"
              >
                $ clear
              </button>
            </div>
          </div>
        )}

        {/* ComfyUI Job Queue */}
        {comfyJobs.length > 0 && (
          <section className="animate-slide-up space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono-share text-purple-400/60 text-xs">❯</span>
                <span className="font-orbitron text-[10px] tracking-widest text-purple-400/80">
                  COMFY_QUEUE
                </span>
                <span className="font-mono-share text-[9px] text-muted-foreground/50">
                  [{comfyJobs.filter(j => j.status === "submitting" || j.status === "generating").length} active]
                </span>
              </div>
              {comfyJobs.some(j => j.status === "done" || j.status === "error") && (
                <button
                  onClick={clearFinishedComfyJobs}
                  className="font-mono-share text-[9px] text-muted-foreground/50 hover:text-purple-400 transition-colors"
                >
                  CLEAR FINISHED
                </button>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {comfyJobs.map(job => {
                const isActive = job.status === "submitting" || job.status === "generating";
                const isDone = job.status === "done";
                const isError = job.status === "error";
                const mins = Math.floor(job.elapsed / 60).toString().padStart(2, "0");
                const secs = (job.elapsed % 60).toString().padStart(2, "0");

                return (
                  <div
                    key={job.id}
                    className={`relative border rounded-lg p-3 transition-all overflow-hidden min-w-0 ${isActive
                      ? "border-purple-500/40 bg-purple-500/5 shadow-[0_0_12px_rgba(168,85,247,0.1)]"
                      : isDone
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-red-500/30 bg-red-500/5"
                      }`}
                  >
                    {/* Dismiss button */}
                    {!isActive && (
                      <button
                        onClick={() => dismissComfyJob(job.id)}
                        className="absolute top-2 right-2 p-0.5 rounded hover:bg-background/50 transition-colors text-muted-foreground/40 hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Status row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      {isActive && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
                      {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                      {isError && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}

                      <span className={`font-orbitron text-[9px] tracking-widest uppercase ${isActive ? "text-cyan-400" : isDone ? "text-green-400" : "text-red-400"
                        }`}>
                        {job.status === "submitting" ? "SUBMITTING" : job.status.toUpperCase()}
                      </span>

                      {/* Timer */}
                      <span className={`font-mono-share text-xs tabular-nums ml-auto ${isActive ? "text-purple-300" : "text-muted-foreground/50"
                        }`}>
                        {mins}:{secs}
                      </span>
                    </div>

                    {/* Phase */}
                    {isActive && job.phase && (
                      <div className="font-mono-share text-[10px] text-purple-300/80 mb-1 animate-flicker">
                        {job.phase}
                      </div>
                    )}

                    {/* Progress bar for active jobs */}
                    {isActive && (
                      <div className="w-full h-0.5 bg-border/30 rounded-full overflow-hidden mb-1.5">
                        <div className="h-full bg-purple-500/50 rounded-full" style={{ width: "100%", animation: "pulse 1.5s ease-in-out infinite" }} />
                      </div>
                    )}

                    {/* Prompt preview */}
                    <div className="font-mono-share text-[10px] text-muted-foreground/60 truncate">
                      {job.prompt}
                    </div>

                    {/* Workflow badge + seed */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono-share text-[8px] text-purple-400/50 uppercase bg-purple-500/10 px-1.5 py-0.5 rounded">
                        {job.workflowType}
                      </span>
                      {job.seed && (
                        <span className="font-mono-share text-[8px] text-muted-foreground/40">
                          seed: {job.seed}
                        </span>
                      )}
                    </div>

                    {/* Error message */}
                    {isError && job.error && (
                      <div className="font-mono-share text-[9px] text-red-400/80 mt-1.5 line-clamp-2">
                        {job.error}
                      </div>
                    )}

                    {/* Hint text for active */}
                    {isActive && (
                      <div className="font-mono-share text-[8px] text-muted-foreground/30 mt-1">
                        {job.elapsed > 120 ? "Complex renders can take 3-5 min" : job.elapsed > 30 ? "GPU is working hard..." : "Processing..."}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Results */}
        <section className="animate-slide-up" style={{ animationDelay: "300ms" }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="font-mono-share text-secondary/40 text-xs">❯</span>
            <GlitchText
              text="OUTPUT_STREAM"
              className="font-orbitron text-[10px] tracking-widest text-muted-foreground"
              glitchIntensity="low"
            />
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <ResultsGrid
            results={results}
            isLoading={isLoading}
            elapsedSeconds={elapsedSeconds}
            loadingPhase={comfyPhase}
            onClear={clearResults}
            onDelete={deleteResult}
            onEditImage={handleEditImage}
            onAnimateImage={handleAnimateImage}
            folders={foldersHook.folders}
            selectedFilter={foldersHook.selectedFilter}
            onSelectFilter={foldersHook.selectFilter}
            onCreateFolder={foldersHook.createFolder}
            onRenameFolder={foldersHook.renameFolder}
            onDeleteFolder={foldersHook.deleteFolder}
            onToggleFolderHidden={foldersHook.toggleFolderHidden}
            onMoveToFolder={handleMoveToFolder}
          />
        </section>

        {/* Footer */}
        <footer className="text-center py-6 border-t border-border/30 space-y-3 overflow-hidden">
          <p className="font-mono-share text-[10px] text-muted-foreground/40 animate-flicker">
            <span className="text-primary/30">$</span>{" "}
            echo "POWERED BY xAI // {effectiveApiMode === "credits" ? "CREDIT-BASED" : "CLIENT-SIDE"} RENDERING"
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono-share text-[10px] px-4">
            <button
              onClick={() => setGuideOpen(true)}
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors"
            >
              <HelpCircle className="w-3 h-3" />
              GUIDE
            </button>
            <span className="text-border/50">|</span>
            <button
              onClick={() => setTosOpen(true)}
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors"
            >
              <Shield className="w-3 h-3" />
              TERMS
            </button>
            <span className="text-border/50">|</span>
            <button
              onClick={() => setPrivacyOpen(true)}
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-secondary transition-colors"
            >
              <Eye className="w-3 h-3" />
              PRIVACY
            </button>
            <span className="text-border/50">|</span>
            <a
              href="https://discord.gg/Ge9AxRgCmM"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-accent transition-colors"
            >
              <MessageCircle className="w-3 h-3" />
              DISCORD
            </a>
            <span className="text-border/50">|</span>
            <a
              href="https://dexscreener.com/base/0xa36f942a5ee23030ac66fb0677540365c0939e662df33f729c5fa5a301eea6d2"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-muted-foreground/40 hover:text-green-400 transition-colors"
            >
              <span className="text-[8px] font-bold leading-none border border-current rounded-sm px-0.5">$</span>
              GROKRUN
            </a>
            {auth.isAuthenticated && (
              <>
                <span className="text-border/50">|</span>
                <Link
                  to="/characters"
                  className="flex items-center gap-1 text-muted-foreground/40 hover:text-purple-400 transition-colors"
                >
                  <Users className="w-3 h-3" />
                  CHARACTERS
                </Link>
              </>
            )}
            {auth.user?.email === "cyberdreadx@proton.me" && (
              <>
                <span className="text-border/50">|</span>
                <Link
                  to="/admin"
                  className="flex items-center gap-1 text-muted-foreground/40 hover:text-primary transition-colors"
                >
                  <Server className="w-3 h-3" />
                  ADMIN
                </Link>
              </>
            )}
          </div>
        </footer>

        {/* Dialogs */}
        <HowToUseDialog open={guideOpen} onOpenChange={setGuideOpen} />
        <LegalDialog type="tos" open={tosOpen} onOpenChange={setTosOpen} />
        <LegalDialog type="privacy" open={privacyOpen} onOpenChange={setPrivacyOpen} />
      </div>
    </CyberLayout>
  );
};

export default Index;

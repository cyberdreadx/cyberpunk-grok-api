import React, { useState, useCallback, Suspense } from "react";
import { Terminal, Key, Coins, Shield, Eye, MessageCircle, HelpCircle, Server, Zap, Cpu, ChevronDown, Film } from "lucide-react";
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
import { useGrokApi, urlToBase64, type GrokMode, type GenerationSettings, type VideoSettings, type ApiMode, type VideoLoraEntry, DEFAULT_SETTINGS, DEFAULT_VIDEO_SETTINGS } from "@/hooks/useGrokApi";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useFolders } from "@/hooks/useFolders";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { useToast } from "@/hooks/use-toast";
import { calculateCreditCost } from "@/lib/api";

const Index = () => {
  const [mode, setMode] = useState<GrokMode>("text-to-image");
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
    generateVideo,
    gltchEdit,
    comfyGenerate,
    comfyVideo,
    comfyTextToVideo,
    comfyLongLook,
    comfyPhase,
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

  // Folders
  const foldersHook = useFolders();

  const { history, addEntry, removeEntry, clearHistory } = usePromptHistory();
  const [activePrompt, setActivePrompt] = useState("");
  const [activeImageUrl, setActiveImageUrl] = useState("");

  // Engine selectors per mode
  type EditEngine = "grok" | "gltch";
  const [editEngine, setEditEngine] = useState<EditEngine>("grok");
  const [gltchHd, setGltchHd] = useState(false);

  type ComfyEngine = "grok" | "comfy";
  const [genEngine, setGenEngine] = useState<ComfyEngine>("grok");
  const [renderEngine, setRenderEngine] = useState<ComfyEngine>("grok");
  const [animateEngine, setAnimateEngine] = useState<ComfyEngine>("grok");

  // ComfyUI settings
  const [comfyCheckpoint, setComfyCheckpoint] = useState("");
  const [comfyLora, setComfyLora] = useState("none");
  const [comfyLoraStrength, setComfyLoraStrength] = useState(0.8);
  const [comfyNegPrompt, setComfyNegPrompt] = useState("");
  const [comfyWidth, setComfyWidth] = useState(1024);
  const [comfyHeight, setComfyHeight] = useState(1024);
  const [comfySteps, setComfySteps] = useState(5);
  const [comfyCfg, setComfyCfg] = useState(1);
  const [comfyFrameCount, setComfyFrameCount] = useState(81);
  const [comfyRife, setComfyRife] = useState(true);
  const [comfyVidUpscale, setComfyVidUpscale] = useState(false);
  const [comfyVideoLora, setComfyVideoLora] = useState("none");
  const [comfyVideoLoraStrength, setComfyVideoLoraStrength] = useState(0.8);
  const [comfyVideoLoraPass, setComfyVideoLoraPass] = useState<"high" | "low" | "both">("both");

  // LongLook settings
  const [longLookEnabled, setLongLookEnabled] = useState(false);
  const [longLookSeqCount, setLongLookSeqCount] = useState(2);
  const [longLookMotionScale, setLongLookMotionScale] = useState(1.2);
  const [longLookFreeLong, setLongLookFreeLong] = useState(false);
  const [longLookFrameCount, setLongLookFrameCount] = useState(81);

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

  // Automatically switch to credits mode when user is logged in and doesn't have a BYOK key
  // and back to byok when they have a key set
  const effectiveApiMode = apiMode;
  const canUseCredits = auth.isAuthenticated && creditsHook.enabled;

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
    const isGltchEdit = mode === "edit-image" && editEngine === "gltch" && effectiveApiMode === "credits";
    const isComfyGen = mode === "text-to-image" && genEngine === "comfy";
    const isComfyRender = mode === "text-to-video" && renderEngine === "comfy";
    const isComfyAnimate = mode === "image-to-video" && animateEngine === "comfy" && !longLookEnabled;
    const isComfyLongLook = mode === "image-to-video" && animateEngine === "comfy" && longLookEnabled;
    const isComfy = isComfyGen || isComfyRender || isComfyAnimate || isComfyLongLook;

    // Check access: need either API key (BYOK) or credits
    if (!isGltchEdit && !isComfy && effectiveApiMode === "byok" && !apiKeySet) {
      toast({
        title: "ACCESS DENIED",
        description: "Configure your xAI API key first, or switch to Credits mode.",
        variant: "destructive",
      });
      return;
    }

    // Comfy and GLTCH always require auth
    if (isComfy || isGltchEdit) {
      if (!auth.isAuthenticated) {
        toast({
          title: "ACCESS DENIED",
          description: "Sign in to use credits.",
          variant: "destructive",
        });
        return;
      }
    }

    if ((effectiveApiMode === "credits" || isGltchEdit || isComfy) && !isAdmin) {
      if (!auth.isAuthenticated) {
        toast({ title: "ACCESS DENIED", description: "Sign in to use credits.", variant: "destructive" });
        return;
      }

      // Calculate cost
      let cost: number;
      if (isGltchEdit) {
        cost = calculateCreditCost(gltchHd ? "gltch-edit-hd" : "gltch-edit");
      } else if (isComfyGen) {
        cost = calculateCreditCost("comfy-image");
      } else if (isComfyLongLook) {
        cost = calculateCreditCost("comfy-longlook", longLookSeqCount);
      } else if (isComfyRender || isComfyAnimate) {
        cost = calculateCreditCost("comfy-video");
      } else {
        const imageCount = (mode === "text-to-image" || mode === "edit-image") ? settings.count : 1;
        const videoDuration = (mode === "text-to-video" || mode === "image-to-video") ? videoSettings.duration : 0;
        cost = calculateCreditCost(mode, imageCount, videoDuration);
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

    try {
      if (isComfyGen) {
        await comfyGenerate({
          prompt: data.prompt,
          negativePrompt: comfyNegPrompt || undefined,
          checkpoint: comfyCheckpoint,
          lora: comfyLora !== "none" ? comfyLora : undefined,
          loraStrength: comfyLoraStrength,
          width: comfyWidth,
          height: comfyHeight,
          steps: comfySteps,
          cfg: comfyCfg,
        });
      } else if (isComfyRender) {
        await comfyTextToVideo({
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
        });
      } else if (isComfyLongLook) {
        const imageBase64 = data.imageUrl?.startsWith("data:")
          ? data.imageUrl
          : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
        if (!imageBase64) throw new Error("Image is required for LongLook");
        await comfyLongLook({
          prompt: data.prompt,
          negativePrompt: comfyNegPrompt || undefined,
          imageBase64,
          sequenceCount: longLookSeqCount,
          frameCount: longLookFrameCount,
          motionScale: longLookMotionScale,
          useFreeLong: longLookFreeLong,
          useRife: comfyRife,
          useUpscale: comfyVidUpscale,
          videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
          videoLoraStrength: comfyVideoLoraStrength,
          videoLoraPass: comfyVideoLoraPass,
        });
      } else if (isComfyAnimate) {
        const imageBase64 = data.imageUrl?.startsWith("data:")
          ? data.imageUrl
          : data.imageUrl ? await urlToBase64(data.imageUrl) : "";
        if (!imageBase64) throw new Error("Image is required for animation");
        await comfyVideo({
          prompt: data.prompt,
          negativePrompt: comfyNegPrompt || undefined,
          imageBase64,
          frameCount: comfyFrameCount,
          useRife: comfyRife,
          useUpscale: comfyVidUpscale,
          videoLora: comfyVideoLora !== "none" ? comfyVideoLora : undefined,
          videoLoraStrength: comfyVideoLoraStrength,
          videoLoraPass: comfyVideoLoraPass,
        });
      } else if (isGltchEdit) {
        await gltchEdit({
          prompt: data.prompt,
          image_url: data.imageUrl!,
          aspectRatio: settings.aspectRatio,
          hd: gltchHd,
        });
      } else {
        switch (mode) {
          case "text-to-image":
            await generateImage({ prompt: data.prompt, settings });
            break;
          case "edit-image":
            await editImage({ prompt: data.prompt, image_url: data.imageUrl!, settings });
            break;
          case "text-to-video":
            await generateVideo({ prompt: data.prompt, videoSettings });
            break;
          case "image-to-video":
            await generateVideo({ prompt: data.prompt, image_url: data.imageUrl, videoSettings });
            break;
        }
      }

      // Optimistically deduct credits on success (admin is free on backend)
      if ((effectiveApiMode === "credits" || isComfy || isGltchEdit) && !isAdmin) {
        let cost: number;
        if (isGltchEdit) {
          cost = calculateCreditCost(gltchHd ? "gltch-edit-hd" : "gltch-edit");
        } else if (isComfyGen) {
          cost = calculateCreditCost("comfy-image");
        } else if (isComfyLongLook) {
          cost = calculateCreditCost("comfy-longlook", longLookSeqCount);
        } else if (isComfyRender || isComfyAnimate) {
          cost = calculateCreditCost("comfy-video");
        } else {
          const imageCount = (mode === "text-to-image" || mode === "edit-image") ? settings.count : 1;
          const videoDuration = (mode === "text-to-video" || mode === "image-to-video") ? videoSettings.duration : 0;
          cost = calculateCreditCost(mode, imageCount, videoDuration);
        }
        creditsHook.deductCreditsLocally(cost);
        setTimeout(() => creditsHook.refreshCredits(), 2000);
      }

      toast({
        title: "RENDER COMPLETE",
        description: "Output generated successfully.",
      });
    } catch (err: any) {
      const msg = err.message || "Generation failed.";
      // Split multi-line errors (e.g. billing hints) and show first line as description, rest as secondary
      const lines = msg.split("\n").filter((l: string) => l.trim());
      toast({
        title: "SYSTEM_ERROR",
        description: lines[0],
        variant: "destructive",
        duration: lines.length > 1 ? 12000 : 5000,
      });
      // Show follow-up hint as second toast if there's extra context
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
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"
              }`}
            />

            {/* API Mode toggle: BYOK vs Credits */}
            {(canUseCredits || apiKeySet) && (
              <div className="flex items-center bg-card/60 border border-border/50 rounded overflow-hidden">
                <button
                  onClick={() => setApiMode("byok")}
                  className={`flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-mono-share transition-colors ${
                    effectiveApiMode === "byok"
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
                    className={`flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-mono-share transition-colors ${
                      effectiveApiMode === "credits"
                        ? "bg-secondary/20 text-secondary"
                        : "text-muted-foreground/50 hover:text-muted-foreground"
                    }`}
                  >
                    <Coins className="w-2.5 h-2.5" />
                    CREDITS
                  </button>
                )}
              </div>
            )}

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
                packages={creditsHook.packages}
                subscriptionTiers={creditsHook.subscriptionTiers}
                onPurchase={creditsHook.purchaseCredits}
                onSubscribe={creditsHook.subscribeToPlan}
                onManageSubscription={creditsHook.manageSubscription}
                onPayPalSuccess={creditsHook.refreshCredits}
              />
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
          <ModeSelector activeMode={mode} onModeChange={(m) => { setMode(m); setActiveImageUrl(""); }} />
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
              <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${
                isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"
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

            {/* Engine selector — shows in edit-image + credits mode */}
            {mode === "edit-image" && effectiveApiMode === "credits" && (
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
                    <div className={`font-orbitron text-[11px] ${editEngine === "grok" ? "text-primary" : "text-foreground"}`}>
                      GROK
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={editEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>
                        {settings.count} cr
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditEngine("gltch")}
                    className={`
                      p-2.5 border rounded text-left transition-all duration-200
                      ${editEngine === "gltch"
                        ? "border-secondary neon-border bg-secondary/5"
                        : "border-border bg-card/30 hover:border-secondary/40"
                      }
                    `}
                  >
                    <div className={`font-orbitron text-[11px] ${editEngine === "gltch" ? "text-secondary" : "text-foreground"}`}>
                      GLTCH
                    </div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>Qwen Edit</span>
                      <span className={editEngine === "gltch" ? "text-secondary/70" : "text-muted-foreground/50"}>
                        {gltchHd ? "2" : "1"} cr
                      </span>
                    </div>
                  </button>
                </div>

                {/* GLTCH HD toggle */}
                {editEngine === "gltch" && (
                  <button
                    type="button"
                    onClick={() => setGltchHd(!gltchHd)}
                    className={`
                      w-full flex items-center justify-between px-3 py-2 border rounded
                      font-mono-share text-[10px] transition-all duration-200
                      ${gltchHd
                        ? "border-secondary/50 bg-secondary/5 text-secondary"
                        : "border-border bg-card/30 text-muted-foreground hover:border-secondary/30"
                      }
                    `}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px]
                        ${gltchHd ? "border-secondary bg-secondary text-secondary-foreground" : "border-muted-foreground/30"}
                      `}>
                        {gltchHd && "✓"}
                      </span>
                      HD UPSCALE (1.5x UltraSharp)
                    </span>
                    <span className="text-[9px]">
                      {gltchHd ? "2 cr" : "+1 cr"}
                    </span>
                  </button>
                )}

                {/* GLTCH info badge */}
                {editEngine === "gltch" && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/5 border border-secondary/20 rounded">
                    <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                    <span className="font-mono-share text-[9px] text-secondary/70">
                      Qwen2.5 VL Edit — 5 step, 1 image per job
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Engine selector — GENERATE mode */}
            {mode === "text-to-image" && auth.isAuthenticated && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setGenEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${genEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] ${genEngine === "grok" ? "text-primary" : "text-foreground"}`}>GROK</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={genEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>{settings.count} cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setGenEngine("comfy")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${genEngine === "comfy" ? "border-purple-500 bg-purple-500/5 shadow-[0_0_8px_rgba(168,85,247,0.15)]" : "border-border bg-card/30 hover:border-purple-500/40"}`}>
                    <div className={`font-orbitron text-[11px] ${genEngine === "comfy" ? "text-purple-400" : "text-foreground"}`}>COMFY</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>GPU Studio</span>
                      <span className={genEngine === "comfy" ? "text-purple-400/70" : "text-muted-foreground/50"}>1 cr</span>
                    </div>
                  </button>
                </div>
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
                        <select value={comfyLora} onChange={(e) => setComfyLora(e.target.value)}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.loras.map((l) => <option key={l} value={l}>{l.replace(/\.[^.]+$/, "")}</option>)}
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
              </div>
            )}

            {/* Engine selector — RENDER (text-to-video) mode */}
            {mode === "text-to-video" && auth.isAuthenticated && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRenderEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${renderEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] ${renderEngine === "grok" ? "text-primary" : "text-foreground"}`}>GROK</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={renderEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>5 cr</span>
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
                        {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }].map((p) => (
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
                        <select value={comfyVideoLora} onChange={(e) => setComfyVideoLora(e.target.value)}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.videoLoras.map((entry) => (
                            <option key={entry.name} value={entry.name}>
                              {entry.name.replace(/_/g, " ")}{entry.high && entry.low ? " (paired)" : ""}
                            </option>
                          ))}
                        </select>
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
            {mode === "image-to-video" && auth.isAuthenticated && (
              <div className="space-y-2">
                <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  ENGINE
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAnimateEngine("grok")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${animateEngine === "grok" ? "border-primary neon-border bg-primary/5" : "border-border bg-card/30 hover:border-primary/40"}`}>
                    <div className={`font-orbitron text-[11px] ${animateEngine === "grok" ? "text-primary" : "text-foreground"}`}>GROK</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>xAI</span>
                      <span className={animateEngine === "grok" ? "text-primary/70" : "text-muted-foreground/50"}>5 cr</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setAnimateEngine("comfy")}
                    className={`p-2.5 border rounded text-left transition-all duration-200 ${animateEngine === "comfy" ? "border-purple-500 bg-purple-500/5 shadow-[0_0_8px_rgba(168,85,247,0.15)]" : "border-border bg-card/30 hover:border-purple-500/40"}`}>
                    <div className={`font-orbitron text-[11px] ${animateEngine === "comfy" ? "text-purple-400" : "text-foreground"}`}>COMFY</div>
                    <div className="font-mono-share text-[9px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>WAN Video</span>
                      <span className={animateEngine === "comfy" ? "text-purple-400/70" : "text-muted-foreground/50"}>3 cr</span>
                    </div>
                  </button>
                </div>
                {/* Comfy ANIMATE settings */}
                {animateEngine === "comfy" && (
                  <div className="space-y-2">
                    {/* LongLook toggle */}
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
                          <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Motion Scale: {longLookMotionScale.toFixed(1)}</label>
                          <input type="range" min={0.5} max={2.0} step={0.1} value={longLookMotionScale}
                            onChange={(e) => setLongLookMotionScale(Number(e.target.value))}
                            className="w-full accent-purple-500" />
                        </div>
                        <button type="button" onClick={() => setLongLookFreeLong(!longLookFreeLong)}
                          className={`w-full flex items-center justify-between px-3 py-2 border rounded font-mono-share text-[10px] transition-all duration-200 ${longLookFreeLong ? "border-purple-500/50 bg-purple-500/5 text-purple-300" : "border-border bg-card/30 text-muted-foreground hover:border-purple-500/30"}`}>
                          <span className="flex items-center gap-1.5">
                            <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${longLookFreeLong ? "border-purple-500 bg-purple-500 text-white" : "border-muted-foreground/30"}`}>
                              {longLookFreeLong && "✓"}
                            </span>
                            FreeLong <span className="text-[8px] text-amber-400/70">(3x VRAM)</span>
                          </span>
                        </button>
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
                          {[{ label: "~2s", value: 33 }, { label: "~3s", value: 49 }, { label: "~5s", value: 81 }, { label: "~7s", value: 113 }].map((p) => (
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
                        4x UltraSharp upscale (slower)
                      </span>
                    </button>
                    {comfyModels.videoLoras.length > 0 && (
                      <div>
                        <label className="font-mono-share text-[9px] text-muted-foreground/70 mb-1 block">Video LoRA (optional)</label>
                        <select value={comfyVideoLora} onChange={(e) => setComfyVideoLora(e.target.value)}
                          className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono-share text-foreground">
                          <option value="none">None</option>
                          {comfyModels.videoLoras.map((entry) => (
                            <option key={entry.name} value={entry.name}>
                              {entry.name.replace(/_/g, " ")}{entry.high && entry.low ? " (paired)" : ""}
                            </option>
                          ))}
                        </select>
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
                          ? `LongLook ${longLookSeqCount} x 3 = ${longLookSeqCount * 3} cr`
                          : "WAN 2.2 I2V — 3 credits per video"}
                      </span>
                    </div>
                  </div>
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

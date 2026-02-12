import React, { useState, useCallback, Suspense } from "react";
import { Terminal, Key, Coins, Shield, Eye, MessageCircle, HelpCircle, Server } from "lucide-react";
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
import { useGrokApi, type GrokMode, type GenerationSettings, type VideoSettings, type ApiMode, DEFAULT_SETTINGS, DEFAULT_VIDEO_SETTINGS } from "@/hooks/useGrokApi";
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
    clearResults,
    deleteResult,
    updateResultFolder,
    clearError,
  } = useGrokApi();

  // Auth & Credits
  const auth = useAuth();
  const creditsHook = useCredits(auth.user);

  // Folders
  const foldersHook = useFolders();

  const { history, addEntry, removeEntry, clearHistory } = usePromptHistory();
  const [activePrompt, setActivePrompt] = useState("");
  const [activeImageUrl, setActiveImageUrl] = useState("");

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
    // Check access: need either API key (BYOK) or credits
    if (effectiveApiMode === "byok" && !apiKeySet) {
      toast({
        title: "ACCESS DENIED",
        description: "Configure your xAI API key first, or switch to Credits mode.",
        variant: "destructive",
      });
      return;
    }

    if (effectiveApiMode === "credits") {
      if (!auth.isAuthenticated) {
        toast({
          title: "ACCESS DENIED",
          description: "Sign in to use credits.",
          variant: "destructive",
        });
        return;
      }
      const imageCount = (mode === "text-to-image" || mode === "edit-image") ? settings.count : 1;
      const videoDuration = (mode === "text-to-video" || mode === "image-to-video") ? videoSettings.duration : 0;
      const cost = calculateCreditCost(mode, imageCount, videoDuration);
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

      // Optimistically deduct credits on success
      if (effectiveApiMode === "credits") {
        const imageCount = (mode === "text-to-image" || mode === "edit-image") ? settings.count : 1;
        const videoDuration = (mode === "text-to-video" || mode === "image-to-video") ? videoSettings.duration : 0;
        const cost = calculateCreditCost(mode, imageCount, videoDuration);
        creditsHook.deductCreditsLocally(cost);
        // Refresh from server to get actual balance
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

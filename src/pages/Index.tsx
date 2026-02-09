import React, { useState, useCallback } from "react";
import { Terminal } from "lucide-react";
import CyberLayout from "@/components/CyberLayout";
import GrokOrb from "@/components/GrokOrb";
import GlitchText from "@/components/GlitchText";
import ModeSelector from "@/components/ModeSelector";
import PromptForm from "@/components/PromptForm";
import SettingsPanel from "@/components/SettingsPanel";
import PromptHistory from "@/components/PromptHistory";
import ResultsGrid from "@/components/ResultsGrid";
import ApiKeyDialog from "@/components/ApiKeyDialog";
import { useGrokApi, type GrokMode, type GenerationSettings, type VideoSettings, DEFAULT_SETTINGS, DEFAULT_VIDEO_SETTINGS } from "@/hooks/useGrokApi";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { useToast } from "@/hooks/use-toast";

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
    setApiKey: setApiKeyRaw,
    clearApiKey: clearApiKeyRaw,
    hasApiKey,
    generateImage,
    editImage,
    generateVideo,
    clearResults,
    deleteResult,
    clearError,
  } = useGrokApi();
  const { history, addEntry, removeEntry, clearHistory } = usePromptHistory();
  const [activePrompt, setActivePrompt] = useState("");
  const [activeImageUrl, setActiveImageUrl] = useState("");
  const [apiKeySet, setApiKeySet] = useState(() => hasApiKey());

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

  const handleSubmit = async (data: { prompt: string; imageUrl?: string }) => {
    if (!apiKeySet) {
      toast({
        title: "ACCESS DENIED",
        description: "Configure your xAI API key first.",
        variant: "destructive",
      });
      return;
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
      toast({
        title: "RENDER COMPLETE",
        description: "Output generated successfully.",
      });
    } catch (err: any) {
      toast({
        title: "SYSTEM ERROR",
        description: err.message || "Generation failed.",
        variant: "destructive",
      });
    }
  };

  return (
    <CyberLayout>
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* Header with Orb */}
        <header className="text-center space-y-2 animate-slide-up">
          {/* Grok Orb */}
          <div className="w-32 h-32 sm:w-48 sm:h-48 md:w-64 md:h-64 mx-auto">
            <GrokOrb isGenerating={isLoading} />
          </div>

          <GlitchText
            text="GROK_IMAGINE"
            as="h1"
            className="font-orbitron text-2xl sm:text-3xl md:text-5xl font-black tracking-wider neon-text-cyan"
            glitchIntensity="medium"
          />
          <p className="font-mono-share text-xs sm:text-sm text-muted-foreground animate-flicker">
            <span className="text-primary/50">$</span> xAI Neural Rendering Interface // v2.0
            <span className="inline-block w-2 h-4 bg-primary/70 ml-1 animate-pulse align-middle" />
          </p>

          {/* Status bar */}
          <div className="flex items-center justify-center gap-3 sm:gap-6 font-mono-share text-[9px] sm:text-[10px] text-muted-foreground/50 pt-2 flex-wrap">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              SYS_ONLINE
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"
              }`}
            />
            <ApiKeyDialog
              hasKey={apiKeySet}
              onSave={handleSaveApiKey}
              onClear={handleClearApiKey}
            />
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
          <ResultsGrid results={results} isLoading={isLoading} elapsedSeconds={elapsedSeconds} onClear={clearResults} onDelete={deleteResult} onEditImage={handleEditImage} onAnimateImage={handleAnimateImage} />
        </section>

        {/* Footer */}
        <footer className="text-center py-6 border-t border-border/30">
          <p className="font-mono-share text-[10px] text-muted-foreground/40 animate-flicker">
            <span className="text-primary/30">$</span> echo "POWERED BY xAI // CLIENT-SIDE RENDERING // ZERO TELEMETRY"
          </p>
        </footer>
      </div>
    </CyberLayout>
  );
};

export default Index;

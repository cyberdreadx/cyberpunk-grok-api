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
import { useGrokApi, type GrokMode, type GenerationSettings, DEFAULT_SETTINGS } from "@/hooks/useGrokApi";
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

  const handleSettingsChange = (next: GenerationSettings) => {
    setSettings(next);
    localStorage.setItem("grok-settings", JSON.stringify(next));
  };
  const { toast } = useToast();
  const {
    isLoading,
    error,
    results,
    setApiKey,
    clearApiKey,
    hasApiKey,
    generateImage,
    editImage,
    generateVideo,
    clearResults,
    clearError,
  } = useGrokApi();
  const { history, addEntry, removeEntry, clearHistory } = usePromptHistory();
  const [activePrompt, setActivePrompt] = useState("");

  const handleSelectPrompt = useCallback((prompt: string) => {
    setActivePrompt(prompt);
  }, []);

  const handleSubmit = async (data: { prompt: string; imageUrl?: string }) => {
    if (!hasApiKey()) {
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
          await generateVideo({ prompt: data.prompt });
          break;
        case "image-to-video":
          await generateVideo({ prompt: data.prompt, image_url: data.imageUrl });
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
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header with Orb */}
        <header className="text-center space-y-2 animate-slide-up">
          {/* Grok Orb */}
          <div className="w-48 h-48 md:w-64 md:h-64 mx-auto">
            <GrokOrb isGenerating={isLoading} />
          </div>

          <GlitchText
            text="GROK_IMAGINE"
            as="h1"
            className="font-orbitron text-3xl md:text-5xl font-black tracking-wider neon-text-cyan"
            glitchIntensity="medium"
          />
          <p className="font-mono-share text-sm text-muted-foreground animate-flicker">
            xAI Neural Rendering Interface // v2.0
          </p>

          {/* Status bar */}
          <div className="flex items-center justify-center gap-6 font-mono-share text-[10px] text-muted-foreground/50 pt-2">
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
              hasKey={hasApiKey()}
              onSave={setApiKey}
              onClear={clearApiKey}
            />
          </div>
        </header>

        {/* Mode selector */}
        <section className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
            <GlitchText
              text="SELECT_MODE"
              className="font-orbitron text-[10px] tracking-widest text-muted-foreground"
              glitchIntensity="low"
            />
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>
          <ModeSelector activeMode={mode} onModeChange={setMode} />
        </section>

        {/* Prompt form */}
        <section
          className="relative border border-border rounded p-5 bg-card/30 backdrop-blur-sm animate-slide-up space-y-4 overflow-hidden"
          style={{ animationDelay: "200ms" }}
        >
          {/* Animated top border */}
          <div
            className="absolute top-0 left-0 right-0 h-[1px]"
            style={{
              background: "linear-gradient(90deg, transparent, hsl(180 100% 50%), hsl(300 100% 60%), hsl(270 100% 65%), transparent)",
              backgroundSize: "200% 100%",
              animation: "border-flow 3s linear infinite",
            }}
          />

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${
              isLoading ? "bg-secondary animate-pulse" : "bg-primary animate-pulse-glow"
            }`} />
            <GlitchText
              text="INPUT_TERMINAL"
              className="font-orbitron text-xs tracking-wider text-foreground"
              glitchIntensity="low"
            />
          </div>
          <SettingsPanel settings={settings} onChange={handleSettingsChange} mode={mode} />
          <PromptHistory history={history} onSelect={handleSelectPrompt} onRemove={removeEntry} onClear={clearHistory} />
          <PromptForm mode={mode} isLoading={isLoading} onSubmit={handleSubmit} settings={settings} initialPrompt={activePrompt} />
        </section>

        {/* Error display */}
        {error && (
          <div className="border border-destructive/50 rounded p-4 bg-destructive/5 animate-slide-up">
            <div className="font-orbitron text-xs text-destructive tracking-wider mb-1">
              ERROR_LOG
            </div>
            <p className="font-mono-share text-sm text-destructive/80">{error}</p>
            <button
              onClick={clearError}
              className="font-mono-share text-xs text-muted-foreground hover:text-foreground mt-2 underline"
            >
              DISMISS
            </button>
          </div>
        )}

        {/* Results */}
        <section className="animate-slide-up" style={{ animationDelay: "300ms" }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
            <GlitchText
              text="OUTPUT_STREAM"
              className="font-orbitron text-[10px] tracking-widest text-muted-foreground"
              glitchIntensity="low"
            />
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>
          <ResultsGrid results={results} isLoading={isLoading} onClear={clearResults} />
        </section>

        {/* Footer */}
        <footer className="text-center py-6 border-t border-border/30">
          <p className="font-mono-share text-[10px] text-muted-foreground/40 animate-flicker">
            GROK_IMAGINE // POWERED BY xAI // CLIENT-SIDE RENDERING // ZERO TELEMETRY
          </p>
        </footer>
      </div>
    </CyberLayout>
  );
};

export default Index;

import React, { useState } from "react";
import { Zap, Terminal } from "lucide-react";
import CyberLayout from "@/components/CyberLayout";
import ModeSelector from "@/components/ModeSelector";
import PromptForm from "@/components/PromptForm";
import SettingsPanel from "@/components/SettingsPanel";
import ResultsGrid from "@/components/ResultsGrid";
import ApiKeyDialog from "@/components/ApiKeyDialog";
import { useGrokApi, type GrokMode, type GenerationSettings, DEFAULT_SETTINGS } from "@/hooks/useGrokApi";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [mode, setMode] = useState<GrokMode>("text-to-image");
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS);
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

  const handleSubmit = async (data: { prompt: string; imageUrl?: string }) => {
    if (!hasApiKey()) {
      toast({
        title: "ACCESS DENIED",
        description: "Configure your xAI API key first.",
        variant: "destructive",
      });
      return;
    }

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
        {/* Header */}
        <header className="text-center space-y-4 animate-slide-up">
          <div className="flex items-center justify-center gap-3">
            <Zap className="w-8 h-8 text-primary animate-pulse-glow" />
            <h1 className="font-orbitron text-3xl md:text-4xl font-black tracking-wider neon-text-cyan">
              GROK_IMAGINE
            </h1>
            <Zap className="w-8 h-8 text-secondary animate-pulse-glow" />
          </div>
          <p className="font-mono-share text-sm text-muted-foreground">
            xAI Neural Rendering Interface // v2.0
          </p>

          {/* Status bar */}
          <div className="flex items-center justify-center gap-6 font-mono-share text-[10px] text-muted-foreground/50">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              SYS_ONLINE
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
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
            <span className="font-orbitron text-[10px] tracking-widest text-muted-foreground">
              SELECT_MODE
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>
          <ModeSelector activeMode={mode} onModeChange={setMode} />
        </section>

        {/* Prompt form */}
        <section
          className="border border-border rounded p-5 bg-card/30 backdrop-blur-sm animate-slide-up space-y-4"
          style={{ animationDelay: "200ms" }}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
            <span className="font-orbitron text-xs tracking-wider text-foreground">
              INPUT_TERMINAL
            </span>
          </div>
          <SettingsPanel settings={settings} onChange={setSettings} mode={mode} />
          <PromptForm mode={mode} isLoading={isLoading} onSubmit={handleSubmit} settings={settings} />
        </section>

        {/* Error display */}
        {error && (
          <div className="border border-destructive/50 rounded p-4 bg-destructive/5">
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
            <span className="font-orbitron text-[10px] tracking-widest text-muted-foreground">
              OUTPUT_STREAM
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>
          <ResultsGrid results={results} isLoading={isLoading} onClear={clearResults} />
        </section>

        {/* Footer */}
        <footer className="text-center py-6 border-t border-border/30">
          <p className="font-mono-share text-[10px] text-muted-foreground/40">
            GROK_IMAGINE // POWERED BY xAI // CLIENT-SIDE RENDERING
          </p>
        </footer>
      </div>
    </CyberLayout>
  );
};

export default Index;

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Key,
  Coins,
  UserPlus,
  Sparkles,
  Image,
  Film,
  FolderOpen,
  Download,
  Pencil,
} from "lucide-react";

const SEEN_KEY = "how-to-use-seen";

interface HowToUseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Step {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  body: React.ReactNode;
}

const steps: Step[] = [
  {
    icon: <Sparkles className="w-8 h-8 text-primary" />,
    title: "Welcome to Grok Runner",
    subtitle: "Your AI image & video generator",
    body: (
      <div className="space-y-3">
        <p>
          Grok Runner lets you create <strong>AI-generated images and videos</strong> using
          xAI&#39;s Grok model. You can generate art from text descriptions, edit existing
          images, and even animate them into short videos.
        </p>
        <p className="text-muted-foreground text-sm">
          This quick guide walks you through everything in about 1 minute.
        </p>
      </div>
    ),
  },
  {
    icon: <Key className="w-8 h-8 text-primary" />,
    title: "Two Ways to Use",
    subtitle: "Choose what works for you",
    body: (
      <div className="space-y-4">
        <div className="border border-primary/20 rounded-lg p-3 bg-primary/5">
          <div className="flex items-center gap-2 mb-1.5">
            <Key className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Option A: Bring Your Own Key (free)</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {"Get a free API key from "}
            <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.x.ai</a>
            {", paste it in, and generate directly. You pay xAI for usage \u2014 we never see your key."}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Note: xAI gives free monthly credits, but you may need to add billing for heavy use.
          </p>
        </div>
        <div className="border border-secondary/20 rounded-lg p-3 bg-secondary/5">
          <div className="flex items-center gap-2 mb-1.5">
            <Coins className="w-4 h-4 text-secondary" />
            <span className="font-semibold text-sm">Option B: Use Credits</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Create an account, buy credits or subscribe, and generate without needing an API key. Images: 3 cr · GLTCH Animate: 15 cr · GLTCH PRO: 20 cr.
          </p>
        </div>
      </div>
    ),
  },
  {
    icon: <UserPlus className="w-8 h-8 text-primary" />,
    title: "Getting Started",
    subtitle: "Step-by-step setup",
    body: (
      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
          <p className="text-sm"><strong>For BYOK:</strong> Click the key icon in the top bar, paste your xAI API key, and save. Ready to generate.</p>
        </div>
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-6 h-6 rounded-full bg-secondary/20 text-secondary text-xs font-bold flex items-center justify-center">1</span>
          <p className="text-sm"><strong>For Credits:</strong> {"Click \"Sign In\" in the top bar, create an account, verify your email, then open the Store to buy credits or subscribe."}</p>
        </div>
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span>
          <p className="text-sm">Switch between BYOK and Credits mode using the toggle that appears in the top bar after setup.</p>
        </div>
      </div>
    ),
  },
  {
    icon: <Image className="w-8 h-8 text-primary" />,
    title: "Generating Images",
    subtitle: "Create art from words",
    body: (
      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
          <p className="text-sm">{"Select \"Generate\" mode at the top (it's the default)."}</p>
        </div>
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span>
          <p className="text-sm">{"Type what you want to see. Be descriptive! Example: "}<em>{"\"a neon-lit Tokyo alley at night in the rain, cyberpunk style\""}</em></p>
        </div>
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">3</span>
          <p className="text-sm">{"Click \"Execute\" and wait a few seconds. Your images will appear below."}</p>
        </div>
        <p className="text-xs text-muted-foreground/60">Tip: Use the settings panel to adjust image count and quality before generating.</p>
      </div>
    ),
  },
  {
    icon: <Pencil className="w-8 h-8 text-secondary" />,
    title: "Editing & Video",
    subtitle: "Modify images and create animations",
    body: (
      <div className="space-y-4">
        <div className="border border-border/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Pencil className="w-4 h-4 text-secondary" />
            <span className="font-semibold text-sm">Edit Mode</span>
          </div>
          <p className="text-sm text-muted-foreground">{"Select \"Modify\" mode, upload or paste an image, then describe the changes you want. Example: "}<em>{"\"make the sky sunset orange\""}</em></p>
          <p className="text-xs text-muted-foreground/60 mt-1">You can also click the edit icon on any generated image to load it directly.</p>
        </div>
        <div className="border border-border/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Film className="w-4 h-4 text-secondary" />
            <span className="font-semibold text-sm">Video Mode</span>
          </div>
          <p className="text-sm text-muted-foreground">{"Select \"Render\" or \"Animate\" mode to create short videos from text or images. Videos take a bit longer (up to a minute)."}</p>
        </div>
      </div>
    ),
  },
  {
    icon: <FolderOpen className="w-8 h-8 text-primary" />,
    title: "Organizing & Saving",
    subtitle: "Folders, downloads, and more",
    body: (
      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          <Download className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <p className="text-sm"><strong>Download:</strong> Click the download icon on any image or video to save it to your device.</p>
        </div>
        <div className="flex gap-3 items-start">
          <FolderOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <p className="text-sm"><strong>Folders:</strong> Create folders to organize your creations. Use the folder icon on any result to move it.</p>
        </div>
        <div className="border border-amber-500/20 rounded-lg p-3 bg-amber-500/5 mt-2">
          <p className="text-sm text-amber-200/80">
            <strong>Important:</strong> Your images and videos are stored in your browser only. Clearing browser data will delete them. Always download anything you want to keep!
          </p>
        </div>
      </div>
    ),
  },
];

export default function HowToUseDialog({ open, onOpenChange }: HowToUseDialogProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) localStorage.setItem(SEEN_KEY, "1");
  }, [open]);

  useEffect(() => {
    if (!open) setStep(0);
  }, [open]);

  const current = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-lg max-h-[85vh] !flex flex-col gap-0 p-0 overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-border/30">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-300"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="p-6 flex-1 min-h-0 overflow-y-auto">
          <DialogHeader className="text-center mb-5">
            <div className="mx-auto mb-3 w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              {current.icon}
            </div>
            <DialogTitle className="font-orbitron text-base tracking-wider">
              {current.title}
            </DialogTitle>
            <DialogDescription className="font-rajdhani text-muted-foreground text-sm">
              {current.subtitle}
            </DialogDescription>
          </DialogHeader>

          <div className="font-rajdhani text-foreground/85 leading-relaxed">
            {current.body}
          </div>
        </div>

        {/* Navigation footer */}
        <div className="border-t border-border/30 px-6 py-4 flex items-center justify-between bg-card/80">
          <div className="font-mono-share text-[10px] text-muted-foreground/40">
            {step + 1} / {steps.length}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep((s) => s - 1)}
                className="font-mono-share text-xs gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                BACK
              </Button>
            )}
            {isFirst && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="font-mono-share text-xs text-muted-foreground/60"
              >
                SKIP
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                onClick={() => onOpenChange(false)}
                className="font-orbitron text-xs tracking-wider gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                GOT IT
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep((s) => s + 1)}
                className="font-mono-share text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                NEXT
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
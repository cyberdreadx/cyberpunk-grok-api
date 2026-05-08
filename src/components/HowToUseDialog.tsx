import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
  Diamond,
  Wallet,
  Flame,
  Cpu,
  Crown,
} from "lucide-react";

const HOLDER_TIP_OPTIN_KEY = "holder-tip-show";

const SEEN_KEY = "how-to-use-seen";

interface HowToUseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function HowToUseDialog({ open, onOpenChange }: HowToUseDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) localStorage.setItem(SEEN_KEY, "1");
  }, [open]);

  useEffect(() => {
    if (!open) setStep(0);
  }, [open]);

  const steps = [
    {
      icon: <Sparkles className="w-8 h-8 text-primary" />,
      title: t("howToUse.welcome.title", "Welcome to Grok Runner"),
      subtitle: t("howToUse.welcome.subtitle", "AI image & video generation powered by xAI"),
      body: (
        <div className="space-y-3">
          <p>{t("howToUse.welcome.body1", "Grok Runner lets you generate, edit, and animate images and video using cutting-edge AI models.")}</p>
          <p className="text-muted-foreground text-sm">
            {t("howToUse.welcome.body2", "This quick guide will walk you through the basics. You can revisit it anytime from the help menu.")}
          </p>
        </div>
      ),
    },
    {
      icon: <Key className="w-8 h-8 text-primary" />,
      title: t("howToUse.twoWays.title", "Two Ways to Use"),
      subtitle: t("howToUse.twoWays.subtitle", "Bring your own key or use credits"),
      body: (
        <div className="space-y-4">
          <div className="border border-primary/20 rounded-lg p-3 bg-primary/5">
            <div className="flex items-center gap-2 mb-1.5">
              <Key className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">{t("howToUse.twoWays.optionA", "Option A: BYOK (Bring Your Own Key)")}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("howToUse.twoWays.optionADesc", "Paste your xAI API key and generate for free — you pay xAI directly.")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {t("howToUse.twoWays.optionANote", "Get an API key at console.x.ai")}
            </p>
          </div>
          <div className="border border-secondary/20 rounded-lg p-3 bg-secondary/5">
            <div className="flex items-center gap-2 mb-1.5">
              <Coins className="w-4 h-4 text-secondary" />
              <span className="font-semibold text-sm">{t("howToUse.twoWays.optionB", "Option B: Credits")}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("howToUse.twoWays.optionBDesc", "Subscribe to any plan to unlock 10 free daily credits, the spin wheel, and daily missions. You can also buy credit packs anytime — they never expire.")}
            </p>
          </div>
        </div>
      ),
    },
    {
      icon: <UserPlus className="w-8 h-8 text-primary" />,
      title: t("howToUse.gettingStarted.title", "Getting Started"),
      subtitle: t("howToUse.gettingStarted.subtitle", "Set up in under a minute"),
      body: (
        <div className="space-y-3">
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
            <p className="text-sm">{t("howToUse.gettingStarted.byok1", "BYOK: Tap the key icon in the top bar, paste your xAI API key, and you're ready — generations bill xAI directly.")}</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-secondary/20 text-secondary text-xs font-bold flex items-center justify-center">1</span>
            <p className="text-sm">{t("howToUse.gettingStarted.credits1", "Credits: Create an account, verify your email, then either subscribe (unlocks daily free credits + spin + missions) or buy a credit pack.")}</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span>
            <p className="text-sm">{t("howToUse.gettingStarted.step2", "Pick a mode — Generate, Edit, or Animate — choose an engine (GLTCH is the default; GLTCH PRO is highest quality), and type a prompt.")}</p>
          </div>
        </div>
      ),
    },
    {
      icon: <Image className="w-8 h-8 text-primary" />,
      title: t("howToUse.generating.title", "Generating Images"),
      subtitle: t("howToUse.generating.subtitle", "Text-to-image in seconds"),
      body: (
        <div className="space-y-3">
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
            <p className="text-sm">{t("howToUse.generating.step1", "Select the GENERATE mode from the mode selector.")}</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span>
            <p className="text-sm">
              {t("howToUse.generating.step2", "Type a detailed prompt, e.g.")}{" "}
              <em>{t("howToUse.generating.example", "\"A cyberpunk city at night with neon lights\"")}</em>
            </p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">3</span>
            <p className="text-sm">{t("howToUse.generating.step3", "Hit Generate and wait for your image to appear below.")}</p>
          </div>
          <p className="text-xs text-muted-foreground/60">
            {t("howToUse.generating.tip", "Tip: Use the Enhance button to automatically improve your prompt.")}
          </p>
        </div>
      ),
    },
    {
      icon: <Pencil className="w-8 h-8 text-secondary" />,
      title: t("howToUse.editing.title", "Editing & Animating"),
      subtitle: t("howToUse.editing.subtitle", "Transform existing images"),
      body: (
        <div className="space-y-4">
          <div className="border border-border/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Pencil className="w-4 h-4 text-secondary" />
              <span className="font-semibold text-sm">{t("howToUse.editing.editLabel", "Edit Mode")}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("howToUse.editing.editDesc", "Upload an image and describe the change, e.g.")}{" "}
              <em>{t("howToUse.editing.editExample", "\"Make it anime style\"")}</em>
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {t("howToUse.editing.editTip", "Works with JPG, PNG, WebP, and HEIC photos.")}
            </p>
          </div>
          <div className="border border-border/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Film className="w-4 h-4 text-secondary" />
              <span className="font-semibold text-sm">{t("howToUse.editing.videoLabel", "Animate Mode")}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("howToUse.editing.videoDesc", "Upload an image and describe the motion to bring it to life as a short video.")}
            </p>
          </div>
        </div>
      ),
    },
    {
      icon: <Cpu className="w-8 h-8 text-primary" />,
      title: t("howToUse.engines.title", "Engines & Quality"),
      subtitle: t("howToUse.engines.subtitle", "Pick the right model for the job"),
      body: (
        <div className="space-y-3">
          <div className="border border-primary/20 rounded-lg p-3 bg-primary/5">
            <div className="font-semibold text-sm mb-1">{t("howToUse.engines.gltchProLabel", "GLTCH PRO")}</div>
            <p className="text-sm text-muted-foreground">
              {t("howToUse.engines.gltchProDesc", "Highest quality. Best for finished work — slower, slightly more expensive.")}
            </p>
          </div>
          <div className="border border-secondary/20 rounded-lg p-3 bg-secondary/5">
            <div className="font-semibold text-sm mb-1">{t("howToUse.engines.gltchLabel", "GLTCH (default)")}</div>
            <p className="text-sm text-muted-foreground">
              {t("howToUse.engines.gltchDesc", "Balanced speed and quality. Great for everyday generation, edits, and animation.")}
            </p>
          </div>
          <div className="border border-border/40 rounded-lg p-3 bg-card/40">
            <div className="font-semibold text-sm mb-1">{t("howToUse.engines.grokLabel", "GROK")}</div>
            <p className="text-sm text-muted-foreground">
              {t("howToUse.engines.grokDesc", "xAI's official Grok models. Costs are doubled vs GLTCH; use BYOK to skip credits entirely.")}
            </p>
          </div>
          <p className="text-xs text-muted-foreground/60">
            {t("howToUse.engines.tip", "Tip: GLTCH is selected by default for Generate and Modify. You can switch engines from the Advanced panel.")}
          </p>
        </div>
      ),
    },
    {
      icon: <Crown className="w-8 h-8 text-secondary" />,
      title: t("howToUse.subscriberCredits.title", "Subscriber-only Free Credits"),
      subtitle: t("howToUse.subscriberCredits.subtitle", "How daily credits, spin & missions work"),
      body: (
        <div className="space-y-3">
          <div className="flex gap-3 items-start">
            <Crown className="w-5 h-5 text-secondary shrink-0 mt-0.5" />
            <p className="text-sm">{t("howToUse.subscriberCredits.body1", "Daily free credits, the spin wheel, and the daily missions are exclusive to active subscribers. Pick any plan to unlock them.")}</p>
          </div>
          <div className="flex gap-3 items-start">
            <Coins className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm">{t("howToUse.subscriberCredits.body2", "Credit packs and existing balances are unaffected — they always work, with or without a subscription.")}</p>
          </div>
          <div className="flex gap-3 items-start">
            <Key className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm">{t("howToUse.subscriberCredits.body3", "BYOK users skip credits entirely and pay xAI directly.")}</p>
          </div>
        </div>
      ),
    },
    {
      icon: <FolderOpen className="w-8 h-8 text-primary" />,
      title: t("howToUse.organizing.title", "Your Library"),
      subtitle: t("howToUse.organizing.subtitle", "Manage your creations"),
      body: (
        <div className="space-y-3">
          <div className="flex gap-3 items-start">
            <Download className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm">{t("howToUse.organizing.download", "Download any result by clicking the download icon.")}</p>
          </div>
          <div className="flex gap-3 items-start">
            <FolderOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm">
              {t("howToUse.organizing.folders", "Organize results into folders. Create, rename, and pin folders from the Library page.")}
            </p>
          </div>
          <div className="border border-amber-500/20 rounded-lg p-3 bg-amber-500/5 mt-2">
            <p className="text-sm text-amber-200/80">
              <strong>
                {t("howToUse.organizing.warning", "Important: Results are stored in your browser. Clearing browser data will delete them. Use folders and downloads to keep your work safe.")}
              </strong>
            </p>
          </div>
        </div>
      ),
    },
    {
      icon: <Diamond className="w-8 h-8 text-violet-300" />,
      title: t("howToUse.holder.title", "Holder Program (optional)"),
      subtitle: t("howToUse.holder.subtitle", "Hold XRGE for permanent perks"),
      body: (
        <div className="space-y-3">
          <p className="text-sm">
            {t(
              "howToUse.holder.body1",
              "Hold XRGE to unlock generation discounts, bonus daily credits, NSFW LoRAs and GLTCH PRO. Continuous holders earn streak multipliers up to ×2.",
            )}
          </p>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-start gap-2">
              <Coins className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
              <span>{t("howToUse.holder.perk1", "Up to +25% off generations and +10 daily credits.")}</span>
            </li>
            <li className="flex items-start gap-2">
              <Flame className="w-4 h-4 text-orange-300 shrink-0 mt-0.5" />
              <span>{t("howToUse.holder.perk2", "Streak multiplier grows with continuous holding (30/90/180 days).")}</span>
            </li>
            <li className="flex items-start gap-2">
              <Wallet className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />
              <span>
                {t(
                  "howToUse.holder.where",
                  "Check your tier anytime: Store → XRGE Bank → Holder tab. Your badge also shows on your profile.",
                )}
              </span>
            </li>
          </ul>
          <label className="mt-2 flex items-start gap-2 cursor-pointer rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 hover:bg-violet-500/10 transition-colors">
            <input
              type="checkbox"
              defaultChecked={typeof window !== "undefined" && localStorage.getItem(HOLDER_TIP_OPTIN_KEY) === "1"}
              onChange={(e) => {
                try {
                  if (e.target.checked) localStorage.setItem(HOLDER_TIP_OPTIN_KEY, "1");
                  else localStorage.removeItem(HOLDER_TIP_OPTIN_KEY);
                  window.dispatchEvent(new CustomEvent("holder-tip-changed"));
                } catch { /* ignore */ }
              }}
              className="mt-0.5 accent-violet-400"
            />
            <span className="text-xs text-violet-100/90 leading-snug">
              {t(
                "howToUse.holder.optIn",
                "Show me a tooltip pointing to where I can check my holder tier.",
              )}
            </span>
          </label>
          <p className="text-xs text-muted-foreground/60">
            {t(
              "howToUse.holder.tip",
              "Optional — you can ignore this and still use everything in the app.",
            )}
          </p>
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-lg max-h-[85vh] !flex flex-col gap-0 p-0 overflow-hidden">
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
                {t("howToUse.back", "Back")}
              </Button>
            )}
            {isFirst && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="font-mono-share text-xs text-muted-foreground/60"
              >
                {t("howToUse.skip", "Skip")}
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                onClick={() => onOpenChange(false)}
                className="font-orbitron text-xs tracking-wider gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("howToUse.gotIt", "Got it!")}
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep((s) => s + 1)}
                className="font-mono-share text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("howToUse.next", "Next")}
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

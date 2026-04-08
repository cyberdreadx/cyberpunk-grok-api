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
    { icon: <Sparkles className="w-8 h-8 text-primary" />, titleKey: "howToUse.welcome.title", subtitleKey: "howToUse.welcome.subtitle", body: <div className="space-y-3"><p>{t("howToUse.welcome.body1")}</p><p className="text-muted-foreground text-sm">{t("howToUse.welcome.body2")}</p></div> },
    { icon: <Key className="w-8 h-8 text-primary" />, titleKey: "howToUse.twoWays.title", subtitleKey: "howToUse.twoWays.subtitle", body: <div className="space-y-4"><div className="border border-primary/20 rounded-lg p-3 bg-primary/5"><div className="flex items-center gap-2 mb-1.5"><Key className="w-4 h-4 text-primary" /><span className="font-semibold text-sm">{t("howToUse.twoWays.optionA")}</span></div><p className="text-sm text-muted-foreground">{t("howToUse.twoWays.optionADesc")}</p><p className="text-xs text-muted-foreground/60 mt-1">{t("howToUse.twoWays.optionANote")}</p></div><div className="border border-secondary/20 rounded-lg p-3 bg-secondary/5"><div className="flex items-center gap-2 mb-1.5"><Coins className="w-4 h-4 text-secondary" /><span className="font-semibold text-sm">{t("howToUse.twoWays.optionB")}</span></div><p className="text-sm text-muted-foreground">{t("howToUse.twoWays.optionBDesc")}</p></div></div> },
    { icon: <UserPlus className="w-8 h-8 text-primary" />, titleKey: "howToUse.gettingStarted.title", subtitleKey: "howToUse.gettingStarted.subtitle", body: <div className="space-y-3"><div className="flex gap-3 items-start"><span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span><p className="text-sm">{t("howToUse.gettingStarted.byok1")}</p></div><div className="flex gap-3 items-start"><span className="shrink-0 w-6 h-6 rounded-full bg-secondary/20 text-secondary text-xs font-bold flex items-center justify-center">1</span><p className="text-sm">{t("howToUse.gettingStarted.credits1")}</p></div><div className="flex gap-3 items-start"><span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span><p className="text-sm">{t("howToUse.gettingStarted.step2")}</p></div></div> },
    { icon: <Image className="w-8 h-8 text-primary" />, titleKey: "howToUse.generating.title", subtitleKey: "howToUse.generating.subtitle", body: <div className="space-y-3"><div className="flex gap-3 items-start"><span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span><p className="text-sm">{t("howToUse.generating.step1")}</p></div><div className="flex gap-3 items-start"><span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span><p className="text-sm">{t("howToUse.generating.step2")} <em>{t("howToUse.generating.example")}</em></p></div><div className="flex gap-3 items-start"><span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">3</span><p className="text-sm">{t("howToUse.generating.step3")}</p></div><p className="text-xs text-muted-foreground/60">{t("howToUse.generating.tip")}</p></div> },
    { icon: <Pencil className="w-8 h-8 text-secondary" />, titleKey: "howToUse.editing.title", subtitleKey: "howToUse.editing.subtitle", body: <div className="space-y-4"><div className="border border-border/30 rounded-lg p-3"><div className="flex items-center gap-2 mb-1.5"><Pencil className="w-4 h-4 text-secondary" /><span className="font-semibold text-sm">{t("howToUse.editing.editLabel")}</span></div><p className="text-sm text-muted-foreground">{t("howToUse.editing.editDesc")} <em>{t("howToUse.editing.editExample")}</em></p><p className="text-xs text-muted-foreground/60 mt-1">{t("howToUse.editing.editTip")}</p></div><div className="border border-border/30 rounded-lg p-3"><div className="flex items-center gap-2 mb-1.5"><Film className="w-4 h-4 text-secondary" /><span className="font-semibold text-sm">{t("howToUse.editing.videoLabel")}</span></div><p className="text-sm text-muted-foreground">{t("howToUse.editing.videoDesc")}</p></div></div> },
    { icon: <FolderOpen className="w-8 h-8 text-primary" />, titleKey: "howToUse.organizing.title", subtitleKey: "howToUse.organizing.subtitle", body: <div className="space-y-3"><div className="flex gap-3 items-start"><Download className="w-5 h-5 text-primary shrink-0 mt-0.5" /><p className="text-sm">{t("howToUse.organizing.download")}</p></div><div className="flex gap-3 items-start"><FolderOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" /><p className="text-sm">{t("howToUse.organizing.folders")}</p></div><div className="border border-amber-500/20 rounded-lg p-3 bg-amber-500/5 mt-2"><p className="text-sm text-amber-200/80"><strong>{t("howToUse.organizing.warning")}</strong></p></div></div> },
  ];

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
              {t(current.titleKey)}
            </DialogTitle>
            <DialogDescription className="font-rajdhani text-muted-foreground text-sm">
              {t(current.subtitleKey)}
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
                {t("howToUse.back")}
              </Button>
            )}
            {isFirst && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="font-mono-share text-xs text-muted-foreground/60"
              >
                {t("howToUse.skip")}
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                onClick={() => onOpenChange(false)}
                className="font-orbitron text-xs tracking-wider gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("howToUse.gotIt")}
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep((s) => s + 1)}
                className="font-mono-share text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("howToUse.next")}
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
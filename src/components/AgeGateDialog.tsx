import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { Globe } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ShieldAlert, Shield, Eye, ChevronDown } from "lucide-react";
import LegalDialog from "@/components/LegalDialog";

const AGE_VERIFIED_KEY = "age-verified";

export default function AgeGateDialog() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [ageChecked, setAgeChecked] = useState(false);
  const [tosChecked, setTosChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [tosOpen, setTosOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language?.split("-")[0]) || SUPPORTED_LANGUAGES[0];

  const allChecked = ageChecked && tosChecked && privacyChecked;

  useEffect(() => {
    const verified = localStorage.getItem(AGE_VERIFIED_KEY);
    if (!verified) {
      setOpen(true);
    }
  }, []);

  const handleConfirm = () => {
    if (!allChecked) return;
    localStorage.setItem(AGE_VERIFIED_KEY, "true");
    setOpen(false);
  };

  const handleDecline = () => {
    window.location.href = "https://www.google.com";
  };

  if (!open) return null;

  return (
    <>
      <AlertDialog open={open}>
        <AlertDialogContent className="bg-card border-secondary/40 sm:max-w-md shadow-lg shadow-secondary/10">
          <AlertDialogHeader className="text-center sm:text-center">
            {/* Language selector */}
            <div className="absolute top-3 right-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLangOpen(!langOpen)}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-border/40 bg-background/60 hover:bg-background/80 text-[11px] font-mono-share text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Globe className="w-3 h-3" />
                  <span>{currentLang.flag}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${langOpen ? "rotate-180" : ""}`} />
                </button>
                {langOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border/50 rounded shadow-lg max-h-48 overflow-y-auto w-36">
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => { i18n.changeLanguage(lang.code); setLangOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-[11px] font-mono-share hover:bg-secondary/10 transition-colors flex items-center gap-2 ${
                          lang.code === currentLang.code ? "text-secondary bg-secondary/5" : "text-muted-foreground"
                        }`}
                      >
                        <span>{lang.flag}</span>
                        <span>{lang.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-center mb-3">
              <div className="w-16 h-16 rounded-full border-2 border-secondary/50 flex items-center justify-center bg-secondary/10 animate-pulse-glow">
                <ShieldAlert className="w-8 h-8 text-secondary" />
              </div>
            </div>
            <AlertDialogTitle className="font-orbitron text-lg tracking-wider text-secondary text-center">
              NEURAL LINK VERIFICATION
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-center" asChild>
              <div>
                <p className="font-mono-share text-[10px] text-primary/50 animate-flicker">
                  {"// SECTOR_RESTRICTED // AUTH_REQUIRED //"}
                </p>
                <p className="font-rajdhani text-sm text-foreground/70 leading-relaxed">
                  This sector of the net is restricted to operatives aged{" "}
                  <span className="text-secondary font-bold">18 cycles or older</span>.
                  By proceeding, you confirm your biological chassis has completed
                  at least 18 solar rotations around the nearest star.
                </p>
                <p className="font-rajdhani text-sm text-foreground/50 leading-relaxed">
                  Minors caught in this zone will be escorted out by corporate
                  security drones. No exceptions. No appeals.
                </p>

                {/* Checkboxes */}
                <div className="space-y-2.5 pt-2 text-left">
                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={ageChecked}
                      onChange={(e) => setAgeChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-2 border-secondary/40 bg-background accent-secondary cursor-pointer"
                    />
                    <span className="font-mono-share text-[11px] text-muted-foreground group-hover:text-foreground/80 transition-colors leading-snug">
                      I confirm I am <span className="text-secondary font-bold">18 years or older</span>
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={tosChecked}
                      onChange={(e) => setTosChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-2 border-primary/40 bg-background accent-primary cursor-pointer"
                    />
                    <span className="font-mono-share text-[11px] text-muted-foreground group-hover:text-foreground/80 transition-colors leading-snug">
                      I have read and agree to the{" "}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTosOpen(true); }}
                        className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-0.5"
                      >
                        <Shield className="w-3 h-3" />
                        Terms of Service
                      </button>
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={privacyChecked}
                      onChange={(e) => setPrivacyChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-2 border-secondary/40 bg-background accent-secondary cursor-pointer"
                    />
                    <span className="font-mono-share text-[11px] text-muted-foreground group-hover:text-foreground/80 transition-colors leading-snug">
                      I have read and acknowledge the{" "}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPrivacyOpen(true); }}
                        className="text-secondary underline underline-offset-2 hover:text-secondary/80 inline-flex items-center gap-0.5"
                      >
                        <Eye className="w-3 h-3" />
                        Privacy Policy
                      </button>
                    </span>
                  </label>
                </div>

                <div className="font-mono-share text-[9px] text-muted-foreground/30 border border-border/30 rounded p-2 bg-background/50 mt-2">
                  <div>{">"} age_check --strict --no-bypass</div>
                  <div>{">"} tos_acceptance --required</div>
                  <div>{">"} {allChecked ? "all_checks_passed -- ready_to_jack_in" : "awaiting_confirmation..."}</div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={!allChecked}
              className={`w-full font-orbitron text-xs tracking-wider transition-all ${
                allChecked
                  ? "bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30"
                  : "bg-muted/20 border border-border/30 text-muted-foreground/30 cursor-not-allowed"
              }`}
            >
              {allChecked ? "JACK IN" : "COMPLETE ALL CHECKS TO PROCEED"}
            </AlertDialogAction>
            <AlertDialogCancel
              onClick={handleDecline}
              className="w-full bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 font-orbitron text-xs tracking-wider"
            >
              GET ME OUT OF HERE
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Inline legal dialogs accessible from the checkboxes */}
      <LegalDialog type="tos" open={tosOpen} onOpenChange={setTosOpen} />
      <LegalDialog type="privacy" open={privacyOpen} onOpenChange={setPrivacyOpen} />
    </>
  );
}
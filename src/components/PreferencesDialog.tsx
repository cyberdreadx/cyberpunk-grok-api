/**
 * PreferencesDialog — global, page-agnostic user preferences.
 *
 * Holds preferences that don't belong inside the per-generation
 * `render_config` panel: language, mature-content filter, and
 * (admin-only) the global immersion sliders.
 *
 * Self-contained: fetches/saves master immersion on its own so it can
 * be opened from any page (Feed, Library, Characters, Profile, Index).
 */
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, EyeOff, Zap, Settings as SettingsIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { useMatureFilter } from "@/hooks/useMatureFilter";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_IMMERSION,
  applyImmersionToRoot,
  fetchMasterImmersion,
  saveMasterImmersion,
  type ImmersionSettings,
} from "@/lib/immersion";
import { PULSE_HZ_MAX, PULSE_HZ_MIN } from "@/lib/immersionZones";
import ImmersionPulseGuide from "@/components/ImmersionPulseGuide";
import { useToast } from "@/hooks/use-toast";

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const PreferencesDialog: React.FC<PreferencesDialogProps> = ({ open, onOpenChange }) => {
  const { t, i18n } = useTranslation();
  const { matureFilter, setMatureFilter } = useMatureFilter();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = !!user?.is_admin;

  const [immersion, setImmersion] = useState<ImmersionSettings>(DEFAULT_IMMERSION);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || !isAdmin) return;
    fetchMasterImmersion().then(setImmersion).catch(() => {});
  }, [open, isAdmin]);

  const handleImmersionChange = (next: ImmersionSettings) => {
    setImmersion(next);
    applyImmersionToRoot(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      try {
        await saveMasterImmersion(next);
        toast({ title: t("toast.globalSaved"), description: t("toast.globalSavedDesc") });
      } catch (e) {
        toast({
          title: t("toast.globalSaveError"),
          description: (e as Error).message || "Check API / database.",
          variant: "destructive",
        });
      }
    }, 650);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-card/95 backdrop-blur-md border-primary/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-orbitron text-sm tracking-wider">
            <SettingsIcon className="w-4 h-4 text-primary" />
            PREFERENCES
          </DialogTitle>
          <DialogDescription className="font-mono-share text-[10px] text-muted-foreground/70">
            Account-wide settings. Render-specific options live in render_config.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Language */}
          <section className="space-y-2">
            <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Globe className="w-3 h-3" />
              {t("settings.language").toUpperCase()}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SUPPORTED_LANGUAGES.map((lang) => {
                const active = i18n.language?.startsWith(lang.code);
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => i18n.changeLanguage(lang.code)}
                    className={`p-2 border rounded text-center transition-all duration-200 ${
                      active
                        ? "border-primary neon-border bg-primary/5"
                        : "border-border bg-card/30 hover:border-primary/40"
                    }`}
                  >
                    <div className={`text-sm ${active ? "text-primary" : "text-foreground"}`}>
                      {lang.flag} {lang.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Mature content filter */}
          <section className="space-y-2 pt-4 border-t border-border/30">
            <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
              <EyeOff className="w-3 h-3" />
              MATURE_CONTENT_FILTER
            </label>
            <button
              type="button"
              onClick={() => setMatureFilter(!matureFilter)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md border transition-colors font-mono-share text-[11px] ${
                matureFilter
                  ? "border-amber-400/40 bg-amber-400/5 text-amber-300"
                  : "border-border/40 bg-card/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{matureFilter ? "Blur mature posts & stories" : "Mature content filter OFF"}</span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded ${
                  matureFilter ? "bg-amber-400/20" : "bg-muted/40"
                }`}
              >
                {matureFilter ? "ON" : "OFF"}
              </span>
            </button>
            <p className="font-mono-share text-[9px] text-muted-foreground/60 leading-relaxed">
              When ON, posts and stories the creator marked as mature are blurred until you tap REVEAL.
            </p>
          </section>

          {/* Admin-only: Immersion */}
          {isAdmin && (
            <section className="pt-4 border-t border-red-500/20">
              <label className="font-orbitron text-[10px] tracking-wider text-red-400 flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4" />
                IMMERSION CONTROL
                <span className="text-[9px] text-red-500/50 font-mono-share">(GLOBAL — ALL USERS)</span>
              </label>
              <p className="font-mono-share text-[8px] text-muted-foreground/70 mb-3 leading-relaxed">
                Saves to the server. Everyone loads these values; sliders debounce ~650ms before POST.
              </p>

              <div className="space-y-5">
                {/* Flicker */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1 text-muted-foreground gap-2">
                    <span>FLICKER DEPTH (0–1)</span>
                    <span className="font-mono-share text-red-400 shrink-0">{immersion.flicker.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={immersion.flicker}
                    onChange={(e) => handleImmersionChange({ ...immersion, flicker: parseFloat(e.target.value) })}
                    className="w-full accent-red-500"
                  />
                </div>

                {/* Pulse */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1 text-muted-foreground gap-2">
                    <span>PULSE RATE (Hz)</span>
                    <span className="font-mono-share text-red-400 shrink-0">{immersion.pulseHz.toFixed(3)} Hz</span>
                  </div>
                  <ImmersionPulseGuide hz={immersion.pulseHz} />
                  <input
                    type="range"
                    min={PULSE_HZ_MIN}
                    max={PULSE_HZ_MAX}
                    step="0.05"
                    value={Math.min(PULSE_HZ_MAX, Math.max(PULSE_HZ_MIN, immersion.pulseHz))}
                    onChange={(e) => handleImmersionChange({ ...immersion, pulseHz: parseFloat(e.target.value) })}
                    className="w-full accent-red-500 mt-2"
                  />
                </div>

                {/* Red Shift */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                    <span>RED SHIFT (hue)</span>
                    <span className="font-mono-share text-red-400">{immersion.redShift.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="0.5"
                    value={immersion.redShift}
                    onChange={(e) => handleImmersionChange({ ...immersion, redShift: parseFloat(e.target.value) })}
                    className="w-full accent-red-500"
                  />
                </div>

                {/* Glow */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                    <span>GLOW / BRIGHTNESS BIAS</span>
                    <span className="font-mono-share text-red-400">{immersion.glow.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    value={immersion.glow}
                    onChange={(e) => handleImmersionChange({ ...immersion, glow: parseFloat(e.target.value) })}
                    className="w-full accent-red-500"
                  />
                </div>

                {/* Scanline */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                    <span>SCANLINE WEIGHT</span>
                    <span className="font-mono-share text-red-400">{immersion.scanline.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={immersion.scanline}
                    onChange={(e) => handleImmersionChange({ ...immersion, scanline: parseFloat(e.target.value) })}
                    className="w-full accent-red-500"
                  />
                </div>

                {/* Vignette */}
                <div>
                  <div className="flex justify-between text-[10px] mb-1 text-muted-foreground">
                    <span>VIGNETTE</span>
                    <span className="font-mono-share text-red-400">{immersion.vignette.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={immersion.vignette}
                    onChange={(e) => handleImmersionChange({ ...immersion, vignette: parseFloat(e.target.value) })}
                    className="w-full accent-red-500"
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PreferencesDialog;

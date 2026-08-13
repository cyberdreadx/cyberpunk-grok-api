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
import { Globe, EyeOff, Zap, Settings as SettingsIcon, User, KeyRound, MessageSquare } from "lucide-react";
import { apiFetch } from "@/lib/api";
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
import NotificationEmailPrefs from "@/components/NotificationEmailPrefs";

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const PreferencesDialog: React.FC<PreferencesDialogProps> = ({ open, onOpenChange }) => {
  const { t, i18n } = useTranslation();
  const { matureFilter, setMatureFilter } = useMatureFilter();
  const { user } = useAuth();
  const nsfwUnlocked = !!user?.posting?.purchased || !!user?.is_admin;
  const { toast } = useToast();
  const isAdmin = !!user?.is_admin;

  const [immersion, setImmersion] = useState<ImmersionSettings>(DEFAULT_IMMERSION);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Account (username + password) ──
  const [username, setUsername] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // ── Discord link ──
  const [discordLinked, setDiscordLinked] = useState(false);
  const [discordId, setDiscordId] = useState<string | null>(null);
  const [discordCode, setDiscordCode] = useState("");
  const [discordLinking, setDiscordLinking] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    apiFetch<{ username?: string }>("/profile")
      .then((p) => setUsername(p.username || ""))
      .catch(() => {});
  }, [open, user]);

  const saveUsername = async () => {
    const clean = username.trim().toLowerCase();
    if (clean.length < 3 || clean.length > 24) {
      toast({ title: "Invalid username", description: "Must be 3–24 characters.", variant: "destructive" });
      return;
    }
    if (!/^[a-z0-9_]+$/.test(clean)) {
      toast({ title: "Invalid username", description: "Letters, numbers, and underscores only.", variant: "destructive" });
      return;
    }
    setUsernameSaving(true);
    try {
      await apiFetch("/profile", { method: "PUT", body: { username: clean } });
      setUsername(clean);
      toast({ title: "Username updated" });
    } catch (e) {
      toast({ title: "Couldn't update username", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUsernameSaving(false);
    }
  };

  const savePassword = async () => {
    if (newPw.length < 6) {
      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPw !== confirmPw) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      await apiFetch("/auth/change-password", { method: "POST", body: { current_password: curPw, new_password: newPw } });
      setCurPw(""); setNewPw(""); setConfirmPw("");
      toast({ title: "Password changed" });
    } catch (e) {
      toast({ title: "Couldn't change password", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPwSaving(false);
    }
  };

  // Load Discord link status when the dialog opens.
  useEffect(() => {
    if (!open || !user) return;
    apiFetch<{ linked: boolean; discordId: string | null }>("/discord-link")
      .then((d) => { setDiscordLinked(!!d.linked); setDiscordId(d.discordId); })
      .catch(() => {});
  }, [open, user]);

  const linkDiscord = async () => {
    const code = discordCode.trim().toUpperCase();
    if (!code) return;
    setDiscordLinking(true);
    try {
      const r = await apiFetch<{ linked: boolean; discordId: string }>("/discord-link", { method: "POST", body: { code } });
      setDiscordLinked(true);
      setDiscordId(r.discordId);
      setDiscordCode("");
      toast({ title: "Discord linked", description: "You can now generate from the bot's DMs." });
    } catch (e) {
      toast({ title: "Couldn't link Discord", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDiscordLinking(false);
    }
  };

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
          {/* Account — username + password (logged in only) */}
          {user && (
            <section className="space-y-3">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <User className="w-3 h-3" />
                ACCOUNT
              </label>

              {/* Email (read-only) */}
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono-share">
                <span className="text-muted-foreground/60">EMAIL</span>
                <span className="text-foreground/80 truncate">{user.email}</span>
              </div>

              {/* Username */}
              <div className="space-y-1.5">
                <span className="font-mono-share text-[9px] text-muted-foreground/60">USERNAME</span>
                <div className="flex gap-2">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    autoComplete="username"
                    className="flex-1 bg-card/60 border border-border rounded px-2 py-1.5 text-[11px] font-mono-share text-foreground"
                  />
                  <button
                    type="button"
                    onClick={saveUsername}
                    disabled={usernameSaving}
                    className="px-3 py-1.5 rounded text-[10px] font-mono-share border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {usernameSaving ? "…" : "SAVE"}
                  </button>
                </div>
              </div>

              {/* Change password */}
              <div className="space-y-1.5">
                <span className="font-mono-share text-[9px] text-muted-foreground/60 flex items-center gap-1">
                  <KeyRound className="w-3 h-3" /> CHANGE PASSWORD
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                  placeholder="Current password"
                  className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[11px] font-mono-share text-foreground"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="New password (min 6)"
                  className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[11px] font-mono-share text-foreground"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full bg-card/60 border border-border rounded px-2 py-1.5 text-[11px] font-mono-share text-foreground"
                />
                <button
                  type="button"
                  onClick={savePassword}
                  disabled={pwSaving || !curPw || !newPw}
                  className="w-full px-3 py-1.5 rounded text-[10px] font-mono-share border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {pwSaving ? "SAVING…" : "UPDATE PASSWORD"}
                </button>
              </div>
            </section>
          )}

          {/* Discord link */}
          {user && (
            <section className="space-y-2 pt-4 border-t border-border/30">
              <label className="font-orbitron text-[10px] tracking-wider text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" />
                LINK DISCORD
              </label>
              {discordLinked ? (
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono-share">
                  <span className="text-green-400/80">Linked{discordId ? ` · ${discordId}` : ""}</span>
                  <span className="text-muted-foreground/50 text-[9px]">Use /generate in the bot's DMs</span>
                </div>
              ) : (
                <>
                  <p className="font-mono-share text-[9px] text-muted-foreground/60">
                    Run <span className="text-primary/80">/link</span> in the GltchRunner Discord bot, then paste the code here to use your credits from Discord DMs.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={discordCode}
                      onChange={(e) => setDiscordCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
                      placeholder="LINK CODE"
                      className="flex-1 bg-card/60 border border-border rounded px-2 py-1.5 text-[11px] font-mono-share tracking-widest text-foreground placeholder-muted-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={linkDiscord}
                      disabled={discordLinking || !discordCode.trim()}
                      className="px-3 py-1.5 rounded text-[10px] font-mono-share border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {discordLinking ? "LINKING…" : "LINK"}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Email notifications */}
          {user && <NotificationEmailPrefs />}

          {/* Language */}
          <section className="space-y-2 pt-4 border-t border-border/30">
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
              onClick={() => {
                // Server-enforced: hasPurchased() decides, so flipping this
                // without paying would just produce a toggle that disagrees
                // with the feed it controls.
                if (!nsfwUnlocked) return;
                setMatureFilter(!matureFilter);
              }}
              disabled={!nsfwUnlocked}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md border transition-colors font-mono-share text-[11px] ${
                matureFilter
                  ? "border-amber-400/40 bg-amber-400/5 text-amber-300"
                  : "border-border/40 bg-card/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{!nsfwUnlocked ? "Hide 18+ content (members only)" : matureFilter ? "Hide 18+ content" : "Showing 18+ content"}</span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded ${
                  matureFilter ? "bg-amber-400/20" : "bg-muted/40"
                }`}
              >
                {matureFilter ? "ON" : "OFF"}
              </span>
            </button>
            <p className="font-mono-share text-[9px] text-muted-foreground/60 leading-relaxed">
              On by default. The feed filters 18+ posts out server-side, so they're never
              downloaded. Stories and creator cards blur theirs until you tap REVEAL.
              {!nsfwUnlocked && " Viewing 18+ content requires any credit pack or subscription."}
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

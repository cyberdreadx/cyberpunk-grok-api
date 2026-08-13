import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Menu, Rss, Sparkles, Users, Star, ShieldAlert, FolderOpen, MessageCircle, MessagesSquare, Lightbulb, Gift, DollarSign, Settings as SettingsIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import PreferencesDialog from "@/components/PreferencesDialog";

/**
 * Global hamburger nav drawer mounted on every page (except FeedPage which
 * has its own integrated version with feed filters).
 *
 * Renders a fixed-position trigger button in the top-left corner, just below
 * the macOS-style terminal bar / iOS safe area.
 */
const GlobalNavMenu: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // Skip on routes that have their own header/nav to avoid overlap.
  const HIDE_ON = ["/", "/feed", "/chat", "/terminal"];
  if (HIDE_ON.includes(location.pathname)) return null;

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const isActive = (path: string) => location.pathname === path;

  const navItem = (path: string, Icon: React.ComponentType<{ className?: string }>, label: string, accent = "primary") => (
    <button
      type="button"
      onClick={() => go(path)}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md font-orbitron text-xs tracking-widest transition-colors ${
        isActive(path)
          ? `bg-${accent}/15 text-${accent} border border-${accent}/40`
          : `text-muted-foreground hover:text-${accent} hover:bg-${accent}/5 border border-transparent`
      }`}
      aria-current={isActive(path) ? "page" : undefined}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <>
      {/* Floating trigger — top-left, below terminal bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-3 z-40 flex items-center justify-center p-2 rounded-md border border-primary/40 bg-card/90 text-primary hover:bg-primary/20 transition-colors shadow-[0_0_8px_hsl(var(--primary)/0.2)] backdrop-blur-sm"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 36px)" }}
        aria-label="Open navigation menu"
        title="Menu"
      >
        <Menu className="w-4 h-4" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[85vw] max-w-xs bg-card/95 border-r border-primary/30 backdrop-blur-md p-0 flex flex-col"
        >
          <SheetHeader
            className="px-5 py-4 border-b border-border/30"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
          >
            <SheetTitle className="font-orbitron text-xs tracking-[0.25em] text-primary">
              ▌ NAVIGATION
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
            <div className="space-y-2">
              <div className="px-2 font-mono-share text-[9px] tracking-[0.2em] text-muted-foreground/70">
                ── PAGES ──
              </div>
              <div className="flex flex-col gap-1">
                {navItem("/", Rss, "FEED")}
                {navItem("/create", Sparkles, "CREATE")}
                {navItem("/library", FolderOpen, "LIBRARY")}
                {navItem("/prompts", Lightbulb, "PROMPTS", "secondary")}
                {navItem("/creators", Users, "MODELS")}
                {navItem("/characters", MessageCircle, "CHARACTERS")}
                {isAuthenticated && navItem("/chat", MessagesSquare, "CHAT")}
                {navItem("/apply", Star, "APPLY")}
                {isAuthenticated && navItem("/profile", Star, "MY PROFILE")}
              </div>
            </div>

            {/* Earn — its own section rather than another grey row in PAGES.
                Both of these were previously URL-only, reachable by nobody. */}
            {isAuthenticated && (
              <div className="space-y-2">
                <div className="px-2 font-mono-share text-[9px] tracking-[0.2em] text-muted-foreground/70">
                  ── EARN ──
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => go("/referral")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md font-orbitron text-xs tracking-widest text-muted-foreground hover:text-primary hover:bg-primary/5 border border-transparent transition-colors"
                  >
                    <Gift className="w-4 h-4" /> INVITE + EARN
                  </button>
                  <button
                    type="button"
                    onClick={() => go("/ambassador")}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md font-orbitron text-xs tracking-widest text-green-300 bg-green-500/10 border border-green-500/40 hover:bg-green-500/20 transition-colors"
                  >
                    <span className="flex items-center gap-3">
                      <DollarSign className="w-4 h-4" /> AMBASSADOR
                    </span>
                    <span className="font-mono-share text-[9px] text-green-400/80 tracking-normal">20% CASH</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); setPrefsOpen(true); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md font-orbitron text-xs tracking-widest text-muted-foreground hover:text-primary hover:bg-primary/5 border border-transparent transition-colors w-full"
                >
                  <SettingsIcon className="w-4 h-4" /> SETTINGS
                </button>
              )}
              <button
                type="button"
                onClick={() => { setOpen(false); navigate("/docs"); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md font-mono-share text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <ShieldAlert className="w-4 h-4" /> API DOCS
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </>
  );
};

export default GlobalNavMenu;

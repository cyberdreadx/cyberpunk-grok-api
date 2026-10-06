import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Menu, Rss, Sparkles, Users, Star, ShieldAlert, FolderOpen, MessageCircle, MessagesSquare, Lightbulb, Gift, DollarSign, Megaphone, Settings as SettingsIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api";
import PreferencesDialog from "@/components/PreferencesDialog";
import { isStudio } from "@/lib/edition";

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
  const { isAuthenticated, user } = useAuth();
  /* The AntiReddit promo is 20 payouts total. Linking it after the last one is
     claimed would send people to a dead end, so the entry only appears while
     slots remain. Fetched when the sheet opens rather than on every render. */
  const [promoOpen, setPromoOpen] = useState<{ open: boolean; slots: number } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !isAuthenticated || promoOpen !== null) return;
    apiFetch<{ open: boolean; slotsRemaining: number }>("/promo-claim")
      .then((d) => setPromoOpen({ open: !!d.open, slots: d.slotsRemaining ?? 0 }))
      .catch(() => setPromoOpen({ open: false, slots: 0 }));
  }, [open, isAuthenticated, promoOpen]);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // Opened from the menu button in the app bar (AppTopBar). The floating
  // trigger this used to draw sat over pages' own back links and titles.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("gltch:open-nav", onOpen);
    return () => window.removeEventListener("gltch:open-nav", onOpen);
  }, []);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const isActive = (path: string) => location.pathname === path;

  const navItem = (path: string, Icon: React.ComponentType<{ className?: string }>, label: string, accent = "primary") => (
    <button
      type="button"
      onClick={() => go(path)}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[85vw] max-w-xs bg-card/95 border-r border-primary/30 backdrop-blur-md p-0 flex flex-col"
        >
          <SheetHeader
            className="px-5 py-4 border-b border-border/30"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
          >
            <SheetTitle className="text-base font-semibold text-foreground">
              Menu
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
            <div className="space-y-2">
              <div className="px-2 text-xs font-semibold text-muted-foreground">
                Pages
              </div>
              <div className="flex flex-col gap-1">
                {isStudio ? (
                  // GLTCH Studio: the five things a plain creator needs, nothing social.
                  <>
                    {navItem("/", Sparkles, "Create")}
                    {navItem("/library", FolderOpen, "Library")}
                    {isAuthenticated && navItem("/profile", Star, "Account")}
                    {isAuthenticated && navItem("/referral", Star, "Invite friends")}
                    {navItem("/promo", Star, "Redeem a code")}
                  </>
                ) : (
                  <>
                {navItem("/", Rss, "Feed")}
                {navItem("/create", Sparkles, "Create")}
                {navItem("/library", FolderOpen, "Library")}
                {navItem("/prompts", Lightbulb, "Prompts", "secondary")}
                {navItem("/creators", Users, "Featured models")}
                {navItem("/characters", MessageCircle, "Characters")}
                {isAuthenticated && navItem("/chat", MessagesSquare, "Chat room")}
                {navItem("/apply", Star, "Become a creator")}
                {isAuthenticated && navItem("/profile", Star, "Profile")}
                  </>
                )}
              </div>
            </div>

            {/* Earn — its own section rather than another grey row in PAGES.
                Both of these were previously URL-only, reachable by nobody. */}
            {!isStudio && isAuthenticated && (
              <div className="space-y-2">
                <div className="px-2 text-xs font-semibold text-muted-foreground">
                  Earn
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => go("/referral")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 border border-transparent transition-colors"
                  >
                    <Gift className="w-4 h-4" /> Invite friends
                  </button>
                  {promoOpen?.open && (
                    <button
                      type="button"
                      onClick={() => go("/promo")}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-cyan-300 bg-cyan-500/10 border border-cyan-500/40 hover:bg-cyan-500/20 transition-colors"
                    >
                      <span className="flex items-center gap-3">
                        <Megaphone className="w-4 h-4" /> Free credits
                      </span>
                      <span className="font-mono-share text-tiny text-cyan-400/80 ">
                        {promoOpen.slots} spots left
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => go("/ambassador")}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-green-300 bg-green-500/10 border border-green-500/40 hover:bg-green-500/20 transition-colors"
                  >
                    <span className="flex items-center gap-3">
                      <DollarSign className="w-4 h-4" /> Ambassadors
                    </span>
                    <span className="font-mono-share text-tiny text-green-400/80 ">20% cash</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {isAuthenticated && user?.is_admin && (
                <button
                  type="button"
                  onClick={() => go("/admin")}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-red-300 bg-red-500/10 border border-red-500/40 hover:bg-red-500/20 transition-colors w-full"
                >
                  <span className="flex items-center gap-3">
                    <ShieldAlert className="w-4 h-4" /> Admin
                  </span>
                  <span className="font-mono-share text-tiny text-red-400/80 ">Console</span>
                </button>
              )}
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); setPrefsOpen(true); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 border border-transparent transition-colors w-full"
                >
                  <SettingsIcon className="w-4 h-4" /> Settings
                </button>
              )}
              {!isStudio && (
              <button
                type="button"
                onClick={() => { setOpen(false); navigate("/docs"); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md font-mono-share text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <ShieldAlert className="w-4 h-4" /> API docs
              </button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </>
  );
};

export default GlobalNavMenu;

import React, { useState, Suspense, useEffect } from "react";
import { useTabActive } from "@/hooks/useTabActive";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sparkles, Image, Users, ShoppingCart, MoreHorizontal, HelpCircle, FileText, Shield, ScrollText, Rss, User, Settings as SettingsIcon, BadgeCheck, MessageSquare, Heart, Gift, Star, ClipboardList, Mail, Lightbulb, Ticket, Award, Code, TerminalSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useChatUnread } from "@/hooks/useChatUnread";
import { useDmUnread } from "@/hooks/useDmUnread";
import { isStudio } from "@/lib/edition";

const CommunityPotDialog = lazyWithRetry(() => import("@/components/CommunityPotDialog"), "community-pot-dialog");
const StoreOverlay = lazyWithRetry(() => import("@/components/StoreOverlay"), "store-overlay");
const PreferencesDialog = lazyWithRetry(() => import("@/components/PreferencesDialog"), "preferences-dialog");

interface MobileBottomNavProps {
  isAuthenticated?: boolean;
  onOpenStore?: () => void;
  onOpenGuide?: () => void;
  onOpenChangelog?: () => void;
  onOpenTos?: () => void;
  onOpenPrivacy?: () => void;
  onOpenSettings?: () => void;
  onOpenAuth?: () => void;
}

const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  isAuthenticated,
  onOpenStore,
  onOpenGuide,
  onOpenChangelog,
  onOpenTos,
  onOpenPrivacy,
  onOpenSettings,
  onOpenAuth,
}) => {
  const tabActive = useTabActive();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { totalCredits, loading: creditsLoading } = useCredits(user);
  const { unread: chatUnread } = useChatUnread(!!isAuthenticated);
  const { unread: dmUnread } = useDmUnread(!!isAuthenticated);
  const [moreOpen, setMoreOpen] = useState(false);
  const [potOpen, setPotOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // In Studio, create IS the home page and there is no feed.
  const isFeed = !isStudio && (location.pathname === "/" || location.pathname === "");
  const isCreate = isStudio
    ? location.pathname === "/" || location.pathname === ""
    : location.pathname === "/create";
  const isAccount = location.pathname === "/profile";
  const isCharacters = location.pathname === "/characters";
  const isLibrary = location.pathname === "/library";
  const isChat = location.pathname === "/chat";
  const isMessages = location.pathname === "/messages";
  const creditsBadge = !isAuthenticated ? null : creditsLoading ? "…" : totalCredits > 999 ? "999+" : totalCredits.toString();

  useEffect(() => {
    setMoreOpen(false);
    setPotOpen(false);
  }, [location.pathname]);

  /*
   * GLTCH Studio's bar: four plain destinations in title case. No feed, no
   * messages, no "more" sheet full of social features that Studio does not
   * have — Account replaces it.
   */
  const studioTabs: Array<{
    id: string; label: string; icon: any; active: boolean;
    onClick: () => void; badge?: string | null; newBadge?: boolean;
  }> = [
    { id: "create", label: "Create", icon: Sparkles, active: isCreate,
      onClick: () => { if (!isCreate) navigate("/"); } },
    { id: "library", label: "Library", icon: Image, active: isLibrary,
      onClick: () => { if (!isLibrary) navigate("/library"); } },
    { id: "store", label: "Credits", icon: ShoppingCart, active: false, badge: creditsBadge,
      onClick: () => { if (onOpenStore) onOpenStore(); else navigate("/?store=1"); } },
    { id: "account", label: "Account", icon: User, active: isAccount,
      onClick: () => { if (!isAccount) navigate("/profile"); } },
  ];

  // Every item works on every page: the page's own handler when it passed one,
  // otherwise the nav's own store / settings, or a route that opens the thing.
  const createPath = isStudio ? "/" : "/create";
  const openStore = () => (onOpenStore ? onOpenStore() : setStoreOpen(true));
  const openSettings = () => (onOpenSettings ? onOpenSettings() : setPrefsOpen(true));
  const openGuide = () => (onOpenGuide ? onOpenGuide() : navigate(`${createPath}?open=guide`));
  const openChangelog = () => (onOpenChangelog ? onOpenChangelog() : navigate(`${createPath}?open=changelog`));
  const openAuth = () => (onOpenAuth ? onOpenAuth() : navigate(`${createPath}?signin=1`));

  const tabs: Array<{
    id: string; label: string; icon: any; active: boolean;
    onClick: () => void; badge?: string | null; newBadge?: boolean;
  }> = [
    { id: "feed", label: "Feed", icon: Rss, active: isFeed, onClick: () => { if (!isFeed) navigate("/"); setMoreOpen(false); } },
    { id: "create", label: "Create", icon: Sparkles, active: isCreate, onClick: () => { if (!isCreate) navigate("/create"); setMoreOpen(false); } },
    { id: "library", label: "Library", icon: Image, active: isLibrary, onClick: () => { if (!isLibrary) navigate("/library"); setMoreOpen(false); } },
    isAuthenticated
      ? {
          id: "messages", label: "Inbox", icon: Mail, active: isMessages,
          badge: dmUnread > 0 ? (dmUnread > 9 ? "9+" : String(dmUnread)) : null,
          onClick: () => { if (!isMessages) navigate("/messages"); setMoreOpen(false); },
        }
      : { id: "signin", label: "Sign in", icon: User, active: false, onClick: () => { openAuth(); setMoreOpen(false); } },
    { id: "more", label: "More", icon: MoreHorizontal, active: moreOpen, badge: chatUnread > 0 ? "•" : null, onClick: () => setMoreOpen(!moreOpen) },
  ];

  type Item = { label: string; icon: any; onClick: () => void; hint?: string; tone?: string; show?: boolean };
  const go = (path: string) => () => navigate(path);
  const sections: Array<{ title: string; items: Item[] }> = [
    { title: "Account", items: [
      { label: "Buy credits", icon: ShoppingCart, onClick: openStore, hint: creditsBadge ? `${creditsBadge} left` : undefined, show: isAuthenticated },
      { label: isAuthenticated ? "Profile" : "Sign in", icon: User, onClick: isAuthenticated ? go("/profile") : openAuth },
      { label: "Verification", icon: BadgeCheck, onClick: go("/verification"), show: isAuthenticated },
      { label: "Settings", icon: SettingsIcon, onClick: openSettings },
    ] },
    { title: "Community", items: [
      { label: "Featured models", icon: Users, onClick: go("/creators") },
      { label: "Chat room", icon: MessageSquare, onClick: go("/chat"), hint: chatUnread > 0 ? (chatUnread > 9 ? "9+" : String(chatUnread)) : undefined, tone: "text-primary", show: isAuthenticated },
      { label: "Characters", icon: Heart, onClick: go("/characters"), show: isAuthenticated },
      { label: "Prompts", icon: Lightbulb, onClick: go("/prompts") },
      { label: "Terminal", icon: TerminalSquare, onClick: go("/terminal") },
      { label: "Community pot", icon: Gift, onClick: () => setPotOpen(true), hint: "Free", tone: "text-fuchsia-300", show: isAuthenticated },
    ] },
    { title: "Earn", items: [
      { label: "Invite friends", icon: Star, onClick: go("/referral"), show: isAuthenticated },
      { label: "Redeem a code", icon: Ticket, onClick: go("/promo") },
      { label: "Become a creator", icon: Star, onClick: go("/apply") },
      { label: "Application status", icon: ClipboardList, onClick: go("/apply/status"), show: isAuthenticated },
      { label: "Ambassadors", icon: Award, onClick: go("/ambassador") },
    ] },
    { title: "Help", items: [
      { label: "How to use", icon: HelpCircle, onClick: openGuide },
      { label: "What's new", icon: ScrollText, onClick: openChangelog },
      { label: "API docs", icon: Code, onClick: go("/docs") },
      { label: "Terms", icon: FileText, onClick: onOpenTos ?? go("/terms") },
      { label: "Privacy", icon: Shield, onClick: onOpenPrivacy ?? go("/privacy") },
    ] },
    ...(user?.is_admin ? [{ title: "Admin", items: [{ label: "Admin", icon: Shield, onClick: go("/admin") }] }] : []),
  ];

  const node = (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 sm:hidden bg-black/50" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto bg-card border-t border-border/60 rounded-t-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.5)] animate-slide-up"
            style={{ paddingBottom: "calc(64px + env(safe-area-inset-bottom, 0px))" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="More"
          >
            <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
            {sections.map((sec) => {
              const items = sec.items.filter((i) => i.show !== false);
              if (!items.length) return null;
              return (
                <section key={sec.title} className="px-3 pt-3">
                  <h3 className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{sec.title}</h3>
                  <div className="rounded-xl bg-muted/20 divide-y divide-border/30 overflow-hidden">
                    {items.map((it) => {
                      const Icon = it.icon;
                      return (
                        <button
                          key={it.label}
                          onClick={() => { setMoreOpen(false); it.onClick(); }}
                          className="w-full flex items-center gap-3 px-3 h-12 text-left active:bg-primary/10 transition-colors"
                        >
                          <Icon className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
                          <span className="flex-1 text-[15px] text-foreground/90">{it.label}</span>
                          {it.hint && <span className={`text-xs ${it.tone ?? "text-muted-foreground"}`}>{it.hint}</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 sm:hidden">
        <div className="bg-card/95 backdrop-blur-md border-t border-border/50">
          <div className="flex items-stretch justify-around px-1">
            {(isStudio ? studioTabs : tabs).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={tab.onClick}
                  aria-current={tab.active ? "page" : undefined}
                  className={`flex-1 flex flex-col items-center justify-center gap-1 h-14 transition-colors active:scale-95 ${
                    tab.active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <span className="relative">
                    <Icon className="w-[22px] h-[22px]" strokeWidth={tab.active ? 2.3 : 1.8} />
                    {tab.badge && (
                      <span className="absolute -top-1.5 -end-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-[18px] text-center">
                        {tab.badge}
                      </span>
                    )}
                  </span>
                  <span className={`text-[11px] leading-none ${tab.active ? "font-semibold" : "font-medium"}`}>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <div className="h-[env(safe-area-inset-bottom,0px)]" />
        </div>
      </nav>

      {potOpen && (
        <Suspense fallback={null}>
          <CommunityPotDialog open={potOpen} onClose={() => setPotOpen(false)} />
        </Suspense>
      )}
      {storeOpen && (
        <Suspense fallback={null}>
          <StoreOverlay open={storeOpen} onOpenChange={setStoreOpen} />
        </Suspense>
      )}
      {prefsOpen && (
        <Suspense fallback={null}>
          <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
        </Suspense>
      )}
    </>
  );

  if (typeof document === "undefined") return null;
  if (!tabActive) return null;
  return createPortal(node, document.body);
};

export default MobileBottomNav;

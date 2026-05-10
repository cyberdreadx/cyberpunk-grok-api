import React, { useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sparkles, Image, Users, ShoppingCart, MoreHorizontal, HelpCircle, FileText, Shield, ScrollText, Rss, User, Settings as SettingsIcon, BadgeCheck, MessageSquare, Heart, Gift } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useChatUnread } from "@/hooks/useChatUnread";

const CommunityPotDialog = lazy(() => import("@/components/CommunityPotDialog"));

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
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { totalCredits, loading: creditsLoading } = useCredits(user);
  const { unread: chatUnread } = useChatUnread(!!isAuthenticated);
  const [moreOpen, setMoreOpen] = useState(false);
  const [potOpen, setPotOpen] = useState(false);

  const isFeed = location.pathname === "/" || location.pathname === "";
  const isCreate = location.pathname === "/create";
  const isCharacters = location.pathname === "/characters";
  const isLibrary = location.pathname === "/library";
  const isChat = location.pathname === "/chat";
  const creditsBadge = !isAuthenticated ? null : creditsLoading ? "…" : totalCredits > 999 ? "999+" : totalCredits.toString();

  const tabs: Array<{
    id: string; label: string; icon: any; active: boolean;
    onClick: () => void; badge?: string | null; newBadge?: boolean;
  }> = [
    {
      id: "feed",
      label: "FEED",
      icon: Rss,
      active: isFeed,
      onClick: () => { if (!isFeed) navigate("/"); setMoreOpen(false); },
    },
    {
      id: "create",
      label: t("modes.generate").toUpperCase(),
      icon: Sparkles,
      active: isCreate,
      onClick: () => { if (!isCreate) navigate("/create"); setMoreOpen(false); },
    },
    {
      id: "library",
      label: t("nav.library").toUpperCase(),
      icon: Image,
      active: isLibrary,
      onClick: () => { if (!isLibrary) navigate("/library"); setMoreOpen(false); },
    },
    ...(isAuthenticated ? [
      {
        id: "chat",
        label: "CHAT",
        icon: MessageSquare,
        active: isChat,
        badge: chatUnread > 0 ? (chatUnread > 9 ? "9+" : String(chatUnread)) : null,
        newBadge: chatUnread === 0,
        onClick: () => { if (!isChat) navigate("/chat"); setMoreOpen(false); },
      },
    ] : []),
    {
      id: "store",
      label: t("nav.store").toUpperCase(),
      icon: ShoppingCart,
      active: false,
      badge: creditsBadge,
      onClick: () => {
        if (onOpenStore) onOpenStore();
        else navigate("/create?store=1");
        setMoreOpen(false);
      },
    },
    {
      id: "more",
      label: t("nav.more").toUpperCase(),
      icon: MoreHorizontal,
      active: moreOpen,
      onClick: () => setMoreOpen(!moreOpen),
    },
  ];

  const node = (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute left-2 right-2 bg-card/95 backdrop-blur-md border border-border/60 rounded-lg shadow-[0_-4px_20px_rgba(0,0,0,0.4)] p-2 space-y-0.5 animate-slide-up"
            style={{ bottom: 'calc(62px + env(safe-area-inset-bottom, 0px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            {isAuthenticated && (
              <button
                onClick={() => { onOpenStore?.(); setMoreOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
              >
                <ShoppingCart className="w-4 h-4 text-primary/60" />
                <span className="font-mono-share text-[11px] text-foreground/80">CREDITS</span>
                <span className="ml-auto font-orbitron text-[10px] tracking-wider text-primary">
                  {creditsBadge}
                </span>
              </button>
            )}
            <button
              onClick={() => {
                if (isAuthenticated) navigate("/profile");
                else onOpenAuth?.();
                setMoreOpen(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
            >
              <User className="w-4 h-4 text-primary/60" />
              <span className="font-mono-share text-[11px] text-foreground/80">
                {isAuthenticated ? "PROFILE" : "SIGN IN"}
              </span>
            </button>
            {isAuthenticated && (
              <button
                onClick={() => { navigate("/verification"); setMoreOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
              >
                <BadgeCheck className="w-4 h-4 text-primary/60" />
                <span className="font-mono-share text-[11px] text-foreground/80">VERIFICATION</span>
              </button>
            )}
            {isAuthenticated && (
              <button
                onClick={() => { navigate("/chat"); setMoreOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
              >
                <MessageSquare className="w-4 h-4 text-primary/60" />
                <span className="font-mono-share text-[11px] text-foreground/80">CHAT ROOM</span>
              </button>
            )}
            {isAuthenticated && (
              <button
                onClick={() => { navigate("/characters"); setMoreOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
              >
                <Heart className="w-4 h-4 text-primary/60" />
                <span className="font-mono-share text-[11px] text-foreground/80">CHARACTER CHAT</span>
              </button>
            )}
            {isAuthenticated && (
              <button
                onClick={() => { setPotOpen(true); setMoreOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
              >
                <Gift className="w-4 h-4 text-fuchsia-400/80" />
                <span className="font-mono-share text-[11px] text-foreground/80">COMMUNITY POT</span>
                <span className="ml-auto font-orbitron text-[8px] tracking-wider text-fuchsia-300 border border-fuchsia-400/40 px-1.5 py-0.5 rounded">FREE</span>
              </button>
            )}
            <button
              onClick={() => { onOpenSettings?.(); setMoreOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
            >
              <SettingsIcon className="w-4 h-4 text-primary/60" />
              <span className="font-mono-share text-[11px] text-foreground/80">SETTINGS</span>
            </button>
            <div className="h-px bg-border/30 my-1" />
            <button
              onClick={() => { onOpenGuide?.(); setMoreOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
            >
              <HelpCircle className="w-4 h-4 text-primary/60" />
              <span className="font-mono-share text-[11px] text-foreground/80">HOW TO USE</span>
            </button>
            <button
              onClick={() => { onOpenChangelog?.(); setMoreOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-primary/10 transition-colors"
            >
              <ScrollText className="w-4 h-4 text-primary/60" />
              <span className="font-mono-share text-[11px] text-foreground/80">CHANGELOG</span>
            </button>
            <div className="h-px bg-border/30 my-1" />
            <button
              onClick={() => { onOpenTos?.(); setMoreOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-muted/30 transition-colors"
            >
              <FileText className="w-4 h-4 text-muted-foreground/40" />
              <span className="font-mono-share text-[10px] text-muted-foreground/60">TERMS OF SERVICE</span>
            </button>
            <button
              onClick={() => { onOpenPrivacy?.(); setMoreOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-muted/30 transition-colors"
            >
              <Shield className="w-4 h-4 text-muted-foreground/40" />
              <span className="font-mono-share text-[10px] text-muted-foreground/60">PRIVACY POLICY</span>
            </button>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 sm:hidden">
        <div className="bg-card/95 backdrop-blur-md border-t border-border/50 shadow-[0_-2px_20px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-around px-1 py-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={tab.onClick}
                  className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-all min-w-[56px] active:scale-95 ${
                    tab.active
                      ? "text-primary"
                      : "text-muted-foreground/50 active:text-primary/70"
                  }`}
                >
                  <div className="relative">
                    <Icon className={`w-5 h-5 ${tab.active ? "drop-shadow-[0_0_6px_hsl(var(--primary))]" : ""}`} />
                    {tab.badge && (
                      <span className="absolute -top-2 -right-4 min-w-[1.75rem] rounded-full border border-primary/40 bg-card px-1 py-0.5 text-center font-orbitron text-[8px] leading-none text-primary shadow-[0_0_8px_hsl(var(--primary)/0.2)]">
                        {tab.badge}
                      </span>
                    )}
                    {tab.newBadge && (
                      <span className="absolute -top-2 -right-3 rounded-full border border-fuchsia-400/60 bg-card px-1 py-0.5 text-center font-orbitron text-[7px] leading-none text-fuchsia-300 shadow-[0_0_8px_hsl(300_90%_60%/0.4)] animate-pulse">
                        NEW
                      </span>
                    )}
                    {tab.active && (
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary shadow-[0_0_4px_hsl(var(--primary))]" />
                    )}
                  </div>
                  <span className={`font-orbitron tracking-wider leading-none ${
                    tab.active ? "text-[7px]" : "text-[6px]"
                  }`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="h-[env(safe-area-inset-bottom,0px)] bg-card/95" />
        </div>
      </nav>
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
};

export default MobileBottomNav;

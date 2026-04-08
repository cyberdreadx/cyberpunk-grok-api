import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sparkles, Image, Users, ShoppingCart, MoreHorizontal, HelpCircle, FileText, Shield, ScrollText } from "lucide-react";

interface MobileBottomNavProps {
  isAuthenticated?: boolean;
  onOpenStore?: () => void;
  onOpenGuide?: () => void;
  onOpenChangelog?: () => void;
  onOpenTos?: () => void;
  onOpenPrivacy?: () => void;
}

const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  isAuthenticated,
  onOpenStore,
  onOpenGuide,
  onOpenChangelog,
  onOpenTos,
  onOpenPrivacy,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const isHome = location.pathname === "/" || location.pathname === "";
  const isCharacters = location.pathname === "/characters";
  const isLibrary = location.pathname === "/library";

  const tabs = [
    {
      id: "create",
      label: "CREATE",
      icon: Sparkles,
      active: isHome,
      onClick: () => { if (!isHome) navigate("/"); setMoreOpen(false); },
    },
    {
      id: "library",
      label: "LIBRARY",
      icon: Image,
      active: isLibrary,
      onClick: () => { if (!isLibrary) navigate("/library"); setMoreOpen(false); },
    },
    ...(isAuthenticated ? [{
      id: "characters",
      label: "CHARS",
      icon: Users,
      active: isCharacters,
      onClick: () => { navigate("/characters"); setMoreOpen(false); },
    }] : []),
    {
      id: "store",
      label: "STORE",
      icon: ShoppingCart,
      active: false,
      onClick: () => { onOpenStore?.(); setMoreOpen(false); },
    },
    {
      id: "more",
      label: "MORE",
      icon: MoreHorizontal,
      active: moreOpen,
      onClick: () => setMoreOpen(!moreOpen),
    },
  ];

  /**
   * Portaled to document.body so `position: fixed` is relative to the viewport.
   * CyberLayout uses `.immersion-screen-host` (CSS `filter` on an ancestor), which
   * creates a new containing block and breaks fixed positioning for descendants.
   */
  const node = (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute left-2 right-2 bg-card/95 backdrop-blur-md border border-border/60 rounded-lg shadow-[0_-4px_20px_rgba(0,0,0,0.4)] p-2 space-y-0.5 animate-slide-up"
            style={{ bottom: 'calc(62px + env(safe-area-inset-bottom, 0px))' }}
            onClick={(e) => e.stopPropagation()}
          >
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

      {/* Bottom nav bar */}
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
          {/* Safe area for notched phones */}
          <div className="h-[env(safe-area-inset-bottom,0px)] bg-card/95" />
        </div>
      </nav>
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
};

export default MobileBottomNav;

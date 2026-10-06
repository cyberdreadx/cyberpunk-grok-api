/**
 * The one bar at the top of every page.
 *
 * Replaces three things that each page used to stack at the top: the fake
 * terminal title row ("gltch@gltch:~/neural-render — bash"), a floating menu
 * button that covered pages' own back links, and a floating credits pill that
 * covered their action buttons. One bar, same place on every page:
 *
 *   [menu (desktop)] [back on sub-pages] Title ........ [GPU] [credits] [bell]
 *
 * On phones navigation lives in the bottom nav, so the menu button is desktop
 * only (the bottom nav is hidden there).
 */

import React, { Suspense, useEffect, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Coins, Menu } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import RunpodStatusDot from "@/components/RunpodStatusDot";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { isStudio } from "@/lib/edition";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const StoreOverlay = lazyWithRetry(() => import("@/components/StoreOverlay"), "store-overlay");

/** Height of the bar below the safe area. Pages offset their content by this. */
export const TOP_BAR_PX = 52;

/** Pages reached from the bottom nav: no back arrow, they are top level. */
const TOP_LEVEL = isStudio ? ["/", "/library", "/profile"] : ["/", "/create", "/library", "/messages", "/profile"];

const TITLES: Array<[string, string]> = isStudio
  ? [
      ["/", "Create"],
      ["/library", "Library"],
      ["/profile", "Account"],
      ["/referral", "Invite friends"],
      ["/promo", "Free credits"],
      ["/verification", "Verification"],
    ]
  : [
      ["/", "Feed"],
      ["/create", "Create"],
      ["/library", "Library"],
      ["/profile", "Profile"],
      ["/profile/:username", "Profile"],
      ["/messages", "Messages"],
      ["/characters", "Characters"],
      ["/creators", "Featured models"],
      ["/prompts", "Prompts"],
      ["/referral", "Invite friends"],
      ["/promo", "Free credits"],
      ["/docs", "API docs"],
      ["/api-docs", "API docs"],
      ["/apply", "Become a creator"],
      ["/apply/status", "Your application"],
      ["/ambassador", "Ambassadors"],
      ["/verification", "Verification"],
    ];

export function pageTitle(pathname: string): string {
  for (const [pattern, title] of TITLES) if (matchPath(pattern, pathname)) return title;
  return isStudio ? "GLTCH Studio" : "GLTCH";
}

interface Props {
  /** Overrides the title from the route table (e.g. a profile's @handle). */
  title?: string;
  /** Opens the page's own store if it has one; otherwise the bar opens one. */
  onOpenStore?: () => void;
}

const AppTopBar: React.FC<Props> = ({ title, onOpenStore }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { totalCredits, loading } = useCredits(user);
  const [storeOpen, setStoreOpen] = useState(false);
  const [byok, setByok] = useState(false);

  useEffect(() => {
    const update = () => setByok(!!localStorage.getItem("xai-api-key"));
    update();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  const topLevel = TOP_LEVEL.includes(location.pathname);
  const goBack = () => {
    // A deep link opened in a fresh tab has nothing to go back to.
    if (location.key !== "default" && window.history.length > 1) navigate(-1);
    else navigate("/");
  };
  const openStore = () => (onOpenStore ? onOpenStore() : setStoreOpen(true));
  const credits = loading ? "…" : totalCredits > 99999 ? "99k+" : totalCredits.toLocaleString();

  return (
    <>
      <header
        className="app-top-bar fixed top-0 inset-x-0 z-30 border-b border-border/40 bg-background/95"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto max-w-7xl h-[52px] px-2 sm:px-4 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("gltch:open-nav"))}
            className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          {!topLevel && (
            <button
              type="button"
              onClick={goBack}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className={`font-display font-semibold text-[17px] leading-none text-foreground truncate ${topLevel ? "ps-2" : ""}`}>
            {title ?? pageTitle(location.pathname)}
          </h1>

          <div className="ms-auto flex items-center gap-1">
            {!isStudio && (
              <span className="hidden sm:flex px-1" title="GPU status">
                <RunpodStatusDot />
              </span>
            )}
            {isAuthenticated && (
              <button
                type="button"
                onClick={openStore}
                aria-label={`${credits} credits${byok ? ", using your own key" : ""} — buy more`}
                className="flex items-center gap-1.5 h-8 ps-2.5 pe-3 rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 active:scale-[0.97] transition"
              >
                <Coins className="w-3.5 h-3.5" />
                <span className="text-sm font-semibold tabular-nums leading-none">{credits}</span>
                {byok && <span className="ms-0.5 text-[10px] font-semibold text-secondary leading-none">Key</span>}
              </button>
            )}
            <span className="w-9 h-9 flex items-center justify-center">
              <NotificationBell isAuthenticated={isAuthenticated} />
            </span>
          </div>
        </div>
      </header>
      {storeOpen && (
        <Suspense fallback={null}>
          <StoreOverlay open={storeOpen} onOpenChange={setStoreOpen} />
        </Suspense>
      )}
    </>
  );
};

export default AppTopBar;

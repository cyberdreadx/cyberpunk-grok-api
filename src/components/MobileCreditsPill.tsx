/**
 * MobileCreditsPill — persistent, portal-rendered credits badge
 * shown in the top-right on mobile across all main views (feed, reels,
 * library, characters, profile, generator). Tapping opens the store.
 *
 * Long-press (or tapping the info dot) reveals a small notice explaining
 * how credits behave when BYOK (Bring Your Own Key) mode is active.
 *
 * Hidden on sm+ (desktop has the inline header CreditDisplay).
 */
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Coins, Info, X, ShoppingCart } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";

interface MobileCreditsPillProps {
  onOpenStore?: () => void;
  /**
   * When true, render the pill inline (no portal, no fixed positioning) so
   * it can sit naturally inside a parent header row. Useful on pages like
   * Index where the floating variant collides with the FEED/CREATE toggle.
   */
  inline?: boolean;
}

const MobileCreditsPill: React.FC<MobileCreditsPillProps> = ({ onOpenStore, inline = false }) => {
  const { user, isAuthenticated } = useAuth();
  const { totalCredits, loading } = useCredits(user);
  const [byok, setByok] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [hasTerminal, setHasTerminal] = useState(false);
  const [isRtl, setIsRtl] = useState(false);

  // Detect BYOK whenever the pill mounts or storage changes
  useEffect(() => {
    const update = () => setByok(!!localStorage.getItem("xai-api-key"));
    update();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  // Detect whether the current page renders the CyberLayout terminal bar
  // (Index/Library/Characters). When present, the pill must sit below it
  // to avoid overlapping the macOS-style title row.
  // Also tracks document direction so the pill anchors to the correct
  // edge (right in LTR, left in RTL) and dividers/padding flip naturally.
  useEffect(() => {
    const check = () => {
      setHasTerminal(document.documentElement.dataset.cyberTerminal === "1");
      setIsRtl(document.documentElement.dir === "rtl");
    };
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-cyber-terminal", "dir"],
    });
    return () => obs.disconnect();
  }, []);

  if (typeof document === "undefined") return null;
  if (!isAuthenticated) return null;

  const label = loading ? "…" : totalCredits > 9999 ? "9999+" : totalCredits.toString();

  // Shared pill markup — used by both the floating and inline variants.
  // Single clean tap target: the whole pill opens the store. A tiny info
  // affordance sits as a secondary action without visual segment boxes.
  const pill = (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onOpenStore}
        aria-label={`Open store — ${label} credits${byok ? ", BYOK active" : ""}`}
        className="group inline-flex items-center gap-1.5 h-7 ps-2.5 pe-2 rounded-full border border-primary/40 bg-card/70 backdrop-blur-md hover:bg-card/90 hover:border-primary/60 active:scale-[0.97] transition-all"
      >
        <Coins className="w-3 h-3 text-primary drop-shadow-[0_0_3px_hsl(var(--primary))] shrink-0" />
        <span className="font-orbitron text-[10px] tracking-wider text-primary leading-none">
          {label}
        </span>
        {byok && (
          <span className="font-orbitron text-[8px] tracking-wider text-secondary/90 leading-none px-1 py-0.5 rounded bg-secondary/10 border border-secondary/30">
            BYOK
          </span>
        )}
        <ShoppingCart className="w-3 h-3 text-secondary/80 group-hover:text-secondary transition-colors" />
      </button>
      <button
        type="button"
        onClick={() => setNoticeOpen((v) => !v)}
        aria-label="What are credits?"
        className="flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground/60 hover:text-primary active:scale-95 transition-all"
      >
        <Info className="w-3 h-3" />
      </button>
    </div>
  );

  const noticeBody = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-orbitron text-[10px] tracking-wider text-primary">
          {byok ? "BYOK MODE ACTIVE" : "CREDITS MODE"}
        </h4>
        <button
          onClick={() => setNoticeOpen(false)}
          aria-label="Close"
          className="text-muted-foreground/60 hover:text-foreground"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {byok ? (
        <p className="font-mono-share text-[11px] leading-relaxed text-foreground/80">
          Generations run on your own xAI API key and are billed by xAI —
          they don't consume Lovable credits.
          <br />
          <br />
          Your <span className="text-primary">{label}</span> credits remain
          available and can be used by switching to credits mode in the
          generator. Tap the coin badge anytime to open the store.
        </p>
      ) : (
        <p className="font-mono-share text-[11px] leading-relaxed text-foreground/80">
          You have <span className="text-primary">{label}</span> credits.
          Each generation deducts from daily → subscription → pack credits.
          <br />
          <br />
          Tap the coin badge to open the store, view your balance breakdown,
          or top up.
        </p>
      )}
    </>
  );

  // Inline variant — no portal, no fixed positioning. Notice anchors to
  // the pill itself via an absolutely-positioned popover.
  if (inline) {
    return (
      <div className="sm:hidden relative">
        {pill}
        {noticeOpen && (
          <>
            <div
              className="fixed inset-0 z-[55]"
              onClick={() => setNoticeOpen(false)}
            />
            <div
              className="absolute z-[56] mt-2 w-64 bg-card/95 backdrop-blur-md border border-primary/40 rounded-lg shadow-[0_0_20px_hsl(var(--primary)/0.25)] p-3 animate-fade-in"
              style={isRtl ? { left: 0, top: "100%" } : { right: 0, top: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              {noticeBody}
            </div>
          </>
        )}
      </div>
    );
  }

  const node = (
    <>
      <div
        className="sm:hidden fixed z-[55]"
        style={{
          top: hasTerminal
            ? "calc(env(safe-area-inset-top, 0px) + 36px)"
            : "max(14px, calc(env(safe-area-inset-top, 0px) + 10px))",
          ...(isRtl
            ? { left: "max(12px, env(safe-area-inset-left, 0px))" }
            : { right: "max(12px, env(safe-area-inset-right, 0px))" }),
        }}
      >
        {pill}
      </div>

      {noticeOpen && (
        <div
          className="sm:hidden fixed inset-0 z-[56]"
          onClick={() => setNoticeOpen(false)}
        >
          <div
            className="absolute w-64 bg-card/95 backdrop-blur-md border border-primary/40 rounded-lg shadow-[0_0_20px_hsl(var(--primary)/0.25)] p-3 animate-fade-in"
            style={{
              top: hasTerminal
                ? "calc(env(safe-area-inset-top, 0px) + 72px)"
                : "max(44px, calc(env(safe-area-inset-top, 0px) + 40px))",
              ...(isRtl ? { left: "0.5rem" } : { right: "0.5rem" }),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {noticeBody}
          </div>
        </div>
      )}
    </>
  );

  return createPortal(node, document.body);
};

export default MobileCreditsPill;

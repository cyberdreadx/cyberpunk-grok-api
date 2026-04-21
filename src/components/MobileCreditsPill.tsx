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
import { Coins, Info, X, Key } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useCreditsView } from "@/hooks/useCreditsView";

interface MobileCreditsPillProps {
  onOpenStore?: () => void;
}

const MobileCreditsPill: React.FC<MobileCreditsPillProps> = ({ onOpenStore }) => {
  const { user, isAuthenticated } = useAuth();
  const { totalCredits, loading } = useCredits(user);
  const { view } = useCreditsView();
  const [byok, setByok] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  // Detect BYOK whenever the pill mounts or storage changes
  useEffect(() => {
    const update = () => setByok(!!localStorage.getItem("xai-api-key"));
    update();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  if (typeof document === "undefined") return null;
  if (!isAuthenticated) return null;

  const label = loading ? "…" : totalCredits > 9999 ? "9999+" : totalCredits.toString();

  const node = (
    <>
      <div
        className="sm:hidden fixed z-[55] right-2 flex items-center gap-1"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <button
          onClick={onOpenStore}
          aria-label={
            view === "byok"
              ? `BYOK mode${byok ? " active" : " inactive"}. ${label} credits available. Tap to open store.`
              : `Credits balance: ${label}. Tap to open store.`
          }
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-card/90 backdrop-blur-md active:scale-95 transition-transform ${
            view === "byok"
              ? "border-secondary/50 shadow-[0_0_10px_hsl(var(--secondary)/0.25)]"
              : "border-primary/40 shadow-[0_0_10px_hsl(var(--primary)/0.25)]"
          }`}
        >
          {view === "byok" ? (
            <>
              <Key className={`w-3.5 h-3.5 ${byok ? "text-secondary drop-shadow-[0_0_4px_hsl(var(--secondary))]" : "text-muted-foreground/60"}`} />
              <span className={`font-orbitron text-[10px] tracking-wider leading-none ${byok ? "text-secondary" : "text-muted-foreground/60"}`}>
                {byok ? "BYOK" : "NO KEY"}
              </span>
              <span className="font-orbitron text-[8px] tracking-wider text-primary/80 border-l border-secondary/30 pl-1.5 leading-none flex items-center gap-0.5">
                <Coins className="w-2.5 h-2.5" />
                {label}
              </span>
            </>
          ) : (
            <>
              <Coins className="w-3.5 h-3.5 text-primary drop-shadow-[0_0_4px_hsl(var(--primary))]" />
              <span className="font-orbitron text-[10px] tracking-wider text-primary leading-none">
                {label}
              </span>
              {byok && (
                <span className="font-orbitron text-[8px] tracking-wider text-secondary/90 border-l border-primary/30 pl-1.5 leading-none">
                  BYOK
                </span>
              )}
            </>
          )}
        </button>
        <button
          onClick={() => setNoticeOpen((v) => !v)}
          aria-label="What are credits?"
          className="w-5 h-5 rounded-full border border-primary/30 bg-card/80 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
        >
          <Info className="w-3 h-3 text-primary/70" />
        </button>
      </div>

      {noticeOpen && (
        <div
          className="sm:hidden fixed inset-0 z-[56]"
          onClick={() => setNoticeOpen(false)}
        >
          <div
            className="absolute right-2 w-64 bg-card/95 backdrop-blur-md border border-primary/40 rounded-lg shadow-[0_0_20px_hsl(var(--primary)/0.25)] p-3 animate-fade-in"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 44px)" }}
            onClick={(e) => e.stopPropagation()}
          >
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
          </div>
        </div>
      )}
    </>
  );

  return createPortal(node, document.body);
};

export default MobileCreditsPill;

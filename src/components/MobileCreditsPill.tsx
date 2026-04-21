/**
 * MobileCreditsPill — persistent, portal-rendered credits badge
 * shown in the top-right on mobile across all main views (feed, reels,
 * library, characters, profile, generator). Tapping opens the store.
 *
 * Hidden on sm+ (desktop has the inline header CreditDisplay).
 */
import React from "react";
import { createPortal } from "react-dom";
import { Coins } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";

interface MobileCreditsPillProps {
  onOpenStore?: () => void;
}

const MobileCreditsPill: React.FC<MobileCreditsPillProps> = ({ onOpenStore }) => {
  const { user, isAuthenticated } = useAuth();
  const { totalCredits, loading } = useCredits(user);

  if (typeof document === "undefined") return null;
  if (!isAuthenticated) return null;

  const label = loading ? "…" : totalCredits > 9999 ? "9999+" : totalCredits.toString();

  const node = (
    <button
      onClick={onOpenStore}
      aria-label={`Credits balance: ${label}. Tap to open store.`}
      className="sm:hidden fixed z-[55] right-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/40 bg-card/90 backdrop-blur-md shadow-[0_0_10px_hsl(var(--primary)/0.25)] active:scale-95 transition-transform"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
    >
      <Coins className="w-3.5 h-3.5 text-primary drop-shadow-[0_0_4px_hsl(var(--primary))]" />
      <span className="font-orbitron text-[10px] tracking-wider text-primary leading-none">
        {label}
      </span>
    </button>
  );

  return createPortal(node, document.body);
};

export default MobileCreditsPill;

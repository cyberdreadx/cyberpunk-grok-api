import React, { useState, useCallback } from "react";
import { Share2, Check, X, Flame, Loader2 } from "lucide-react";
import type { GrokResult } from "@/hooks/useGrokApi";

interface ShareCTAProps {
  /** Show the CTA (typically after a generation completes) */
  visible: boolean;
  onDismiss: () => void;
  /** The most recent generated result to share */
  latestResult?: GrokResult | null;
  /** Trigger the real share flow (upload + copy link) */
  onShareResult?: (result: GrokResult) => Promise<void>;
  /** ID of the result currently being shared (for loading state) */
  sharingId?: string | null;
}

const ShareCTA: React.FC<ShareCTAProps> = ({ visible, onDismiss, latestResult, onShareResult, sharingId }) => {
  const [dismissed, setDismissed] = useState(false);

  const isSharing = !!(latestResult && sharingId === latestResult.id);

  const handleShare = useCallback(async () => {
    if (latestResult && onShareResult) {
      await onShareResult(latestResult);
    }
  }, [latestResult, onShareResult]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss();
  }, [onDismiss]);

  if (!visible || dismissed) return null;

  return (
    <div className="relative border border-secondary/30 bg-secondary/5 rounded-lg px-3 py-2.5 mt-3 animate-slide-up">
      <button
        onClick={handleDismiss}
        className="absolute top-1.5 right-1.5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-center gap-2 pr-6">
        <Flame className="w-4 h-4 text-orange-400 shrink-0 animate-pulse" />
        <div className="flex-1 min-w-0">
          <p className="font-mono-share text-[10px] sm:text-[11px] text-foreground/80 leading-relaxed">
            Love this?{" "}
            <span className="text-secondary">Share on Reddit</span> and help others discover Grok Runner
          </p>
        </div>
        <button
          onClick={handleShare}
          disabled={isSharing || !latestResult}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 border border-secondary/40 rounded-full text-secondary hover:bg-secondary/30 transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSharing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="font-orbitron text-[8px] tracking-wider">SHARING</span>
            </>
          ) : (
            <>
              <Share2 className="w-3 h-3" />
              <span className="font-orbitron text-[8px] tracking-wider">SHARE</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ShareCTA;

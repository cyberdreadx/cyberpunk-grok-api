import React, { useState, useCallback } from "react";
import { Share2, X, Flame, Loader2 } from "lucide-react";
import type { GrokResult } from "@/hooks/useGrokApi";

interface ShareCTAProps {
  visible: boolean;
  onDismiss: () => void;
  latestResult?: GrokResult | null;
  onShareResult?: (result: GrokResult) => Promise<void>;
  sharingId?: string | null;
  /** If a share URL is already available (after upload completed) */
  lastShareUrl?: string | null;
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function RedditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

const SITE_URL = "https://grokrunner.gltch.app";

function openTwitterShare(url: string) {
  const text = `Check out what I made with @GLTCHRunner — free AI image & video generation\n\n${url}`;
  window.open(
    `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
    "_blank",
    "width=550,height=420",
  );
}

function openRedditShare(url: string) {
  window.open(
    `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent("Made this with GLTCH Runner — free AI image generator")}`,
    "_blank",
  );
}

const ShareCTA: React.FC<ShareCTAProps> = ({
  visible,
  onDismiss,
  latestResult,
  onShareResult,
  sharingId,
  lastShareUrl,
}) => {
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
            {lastShareUrl ? (
              <>Link ready! <span className="text-secondary">Share it:</span></>
            ) : (
              <>Love it? <span className="text-secondary">Share and help others discover GLTCH Runner</span></>
            )}
          </p>
        </div>

        {lastShareUrl ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => openTwitterShare(lastShareUrl)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-black/40 border border-white/10 rounded-full text-white hover:bg-black/60 transition-all"
              title="Post on X"
            >
              <XIcon className="w-3 h-3" />
              <span className="font-orbitron text-[7px] tracking-wider">POST</span>
            </button>
            <button
              onClick={() => openRedditShare(lastShareUrl)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-600/20 border border-orange-500/30 rounded-full text-orange-400 hover:bg-orange-600/30 transition-all"
              title="Share on Reddit"
            >
              <RedditIcon className="w-3 h-3" />
              <span className="font-orbitron text-[7px] tracking-wider">SHARE</span>
            </button>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
};

export default ShareCTA;

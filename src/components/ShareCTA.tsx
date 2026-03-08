import React, { useState, useEffect, useCallback } from "react";
import { Share2, Copy, Check, X, Flame } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface ShareCTAProps {
  /** Show the CTA (typically after a generation completes) */
  visible: boolean;
  onDismiss: () => void;
}

const ShareCTA: React.FC<ShareCTAProps> = ({ visible, onDismiss }) => {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Fetch referral code once
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const data = await apiFetch("/referral", { method: "POST", body: { action: "get-code" } });
        if (data.code) setReferralCode(data.code);
      } catch {
        // Not logged in — skip
      }
    })();
  }, [visible]);

  const handleShare = useCallback(() => {
    const link = referralCode
      ? `https://grokrunner.gltch.app?ref=${referralCode}`
      : "https://grokrunner.gltch.app";

    const post = `Check out what I generated with Grok Runner — AI image & video generation with a cyberpunk twist 🔥\n\nTry it free: ${link}`;

    navigator.clipboard.writeText(post);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);

    // Track share in localStorage for streak
    const today = new Date().toISOString().split("T")[0];
    const shareLog: string[] = JSON.parse(localStorage.getItem("share-streak") || "[]");
    if (!shareLog.includes(today)) {
      shareLog.push(today);
      localStorage.setItem("share-streak", JSON.stringify(shareLog.slice(-30)));
    }
  }, [referralCode]);

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
          className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 border border-secondary/40 rounded-full text-secondary hover:bg-secondary/30 transition-all shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" />
              <span className="font-orbitron text-[8px] tracking-wider">COPIED</span>
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

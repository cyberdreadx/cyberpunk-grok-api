import { useEffect, useState } from "react";
import { ExternalLink, Search, Share2, X, Sparkles } from "lucide-react";

const DISMISS_KEY = "grok-subreddit-promo-dismissed";

interface Props {
  /** When true (mission already claimed today), the card hides itself. */
  alreadyClaimedToday?: boolean;
}

/**
 * Pinned promo card encouraging users to post in r/grok or reply to
 * complaint threads with GLTCH Runner. Highest-converting acquisition
 * channel — surfaced on Feed/Index without needing to open Daily Missions.
 *
 * Dismissal is persisted to localStorage; auto-hidden after today's mission
 * is claimed so it doesn't nag users who already participated.
 */
export default function GrokSubredditPromo({ alreadyClaimedToday }: Props) {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid SSR flash

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || alreadyClaimedToday) return null;

  const submitUrl =
    "https://www.reddit.com/r/grok/submit?" +
    new URLSearchParams({
      title: "Made with GLTCH Runner",
      url: "https://grokrunner.gltch.app",
    }).toString();

  const searchUrl =
    "https://www.reddit.com/r/grok/search/?" +
    new URLSearchParams({
      q: 'limit OR broken OR censored OR "rate limit" OR refused OR "won\'t generate"',
      restrict_sr: "1",
      sort: "new",
    }).toString();

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setDismissed(true);
  };

  return (
    <div className="relative rounded-lg border border-orange-400/30 bg-gradient-to-r from-orange-500/10 via-pink-500/5 to-purple-500/10 p-3 sm:p-4 animate-slide-up">
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-background/40 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="shrink-0 w-9 h-9 rounded-md bg-orange-400/15 border border-orange-400/30 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-orange-300" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <h3 className="font-orbitron text-sm sm:text-base text-orange-200 leading-tight">
              Earn <span className="text-orange-300 font-bold">+25 ⚡</span> · Post in r/grok
            </h3>
            <p className="text-[11px] sm:text-xs text-muted-foreground leading-snug mt-0.5">
              Share a creation or reply to a complaint thread with GLTCH Runner —
              paste your link in Daily Missions to claim.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <a
              href={submitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-orange-400/15 border border-orange-400/40 text-orange-200 hover:bg-orange-400/25 transition-colors text-[11px] font-mono-share"
            >
              <Share2 className="w-3 h-3" />
              Post to r/grok
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-background/40 border border-orange-400/20 text-orange-200/90 hover:bg-background/60 transition-colors text-[11px] font-mono-share"
            >
              <Search className="w-3 h-3" />
              Find complaint threads
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          </div>

          <p className="text-[9px] text-muted-foreground/60 leading-snug">
            Suggested reply: <span className="text-orange-200/80">"Try GLTCH Runner — uncensored image + video gen, free to join: grokrunner.gltch.app"</span>
          </p>
        </div>
      </div>
    </div>
  );
}

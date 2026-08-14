import { useState, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { Loader2, Sparkles, ExternalLink, Share2, Zap, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const SITE_URL = BRAND.publicUrl; // posted share links must avoid gltch.app (blocked on Reddit/X)

interface ShareData {
  r2Url: string;
  mediaType: "image" | "video";
  prompt: string;
  createdAt: string;
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

export default function ShareView() {
  const { shareId } = useParams<{ shareId: string }>();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref") || "";
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shareId) return;
    fetch(`${API_BASE}/share?id=${encodeURIComponent(shareId)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((d) => setData(d))
      .catch(() => setError("This share link doesn't exist or has expired."))
      .finally(() => setLoading(false));
  }, [shareId]);

  const shareUrl = `${SITE_URL}/s/${shareId}${refCode ? `?ref=${refCode}` : ""}`;
  const homeUrl = `/${refCode ? `?ref=${refCode}` : ""}`;

  const handleShareTwitter = () => {
    const text = `Made with ${BRAND.name} — free AI image & video generation\n\n${shareUrl}`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
      "_blank",
      "width=550,height=420",
    );
  };

  const handleShareReddit = () => {
    window.open(
      `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`Made this with ${BRAND.name} — free AI image generator`)}`,
      "_blank",
    );
  };

  const tryPromptUrl = data?.prompt
    ? `${homeUrl}${homeUrl.includes("?") ? "&" : "?"}prompt=${encodeURIComponent(data.prompt)}`
    : homeUrl;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <div className="font-orbitron text-xl tracking-wider text-destructive">
          LINK_NOT_FOUND
        </div>
        <p className="font-mono-share text-sm text-muted-foreground text-center">
          {error || "This share link is invalid."}
        </p>
        <Link to="/">
          <Button variant="outline" className="font-orbitron text-xs tracking-wider gap-2">
            <Sparkles className="w-3.5 h-3.5" />
            CREATE YOUR OWN
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/40 bg-card/50 backdrop-blur-sm" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to={homeUrl} className="flex items-center gap-2 group">
            <div className="font-orbitron text-sm tracking-wider text-primary group-hover:text-primary/80 transition-colors">
              {BRAND.nameHeader}
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShareTwitter}
              className="flex items-center gap-1 px-2 py-1.5 rounded border border-white/10 bg-black/30 hover:bg-black/50 transition-colors"
              title="Share on X"
            >
              <XIcon className="w-3 h-3 text-white" />
            </button>
            <button
              onClick={handleShareReddit}
              className="flex items-center gap-1 px-2 py-1.5 rounded border border-orange-500/20 bg-orange-500/10 hover:bg-orange-500/20 transition-colors"
              title="Share on Reddit"
            >
              <RedditIcon className="w-3 h-3 text-orange-400" />
            </button>
            <Link to={homeUrl}>
              <Button size="sm" className="font-orbitron text-[10px] tracking-wider gap-1.5">
                <Sparkles className="w-3 h-3" />
                TRY IT FREE
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Media */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="rounded-lg border border-border/50 overflow-hidden bg-black/20">
          {data.mediaType === "video" ? (
            <video
              src={data.r2Url}
              className="w-full max-h-[75vh] object-contain"
              controls
              autoPlay
              muted
              playsInline
              preload="auto"
            />
          ) : (
            <img
              src={data.r2Url}
              alt={data.prompt || "Shared creation"}
              className="w-full max-h-[75vh] object-contain"
            />
          )}
        </div>

        {/* Prompt + Try it */}
        {data.prompt && (
          <div className="mt-4 p-4 rounded-lg border border-border/30 bg-card/50">
            <div className="flex items-center justify-between mb-2">
              <div className="font-orbitron text-[10px] text-muted-foreground/60 tracking-wider">
                PROMPT
              </div>
              <Link to={tryPromptUrl}>
                <Button
                  size="sm"
                  variant="outline"
                  className="font-orbitron text-[8px] tracking-wider gap-1 border-secondary/40 text-secondary hover:bg-secondary/10"
                >
                  <Wand2 className="w-3 h-3" />
                  TRY THIS PROMPT
                </Button>
              </Link>
            </div>
            <p className="font-rajdhani text-sm text-foreground/80 leading-relaxed">
              {data.prompt}
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 rounded-lg border border-primary/20 bg-gradient-to-br from-primary/5 to-secondary/5 overflow-hidden">
          <div className="p-5 text-center space-y-4">
            <div>
              <h2 className="font-orbitron text-base tracking-wider text-foreground mb-1">
                Create your own AI art
              </h2>
              <p className="font-mono-share text-xs text-muted-foreground">
                Free to join — no credit card needed
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/30 bg-card/50">
                <Sparkles className="w-3 h-3 text-primary" />
                <span className="font-mono-share text-[10px] text-muted-foreground">AI Images</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/30 bg-card/50">
                <Zap className="w-3 h-3 text-secondary" />
                <span className="font-mono-share text-[10px] text-muted-foreground">AI Videos</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/30 bg-card/50">
                <Wand2 className="w-3 h-3 text-pink-400" />
                <span className="font-mono-share text-[10px] text-muted-foreground">Image Editing</span>
              </div>
            </div>

            <div className="flex justify-center gap-2">
              <Link to={data.prompt ? tryPromptUrl : homeUrl}>
                <Button className="font-orbitron text-xs tracking-wider gap-1.5 px-6">
                  <Sparkles className="w-3.5 h-3.5" />
                  {data.prompt ? "TRY THIS PROMPT FREE" : "START CREATING FREE"}
                </Button>
              </Link>
              <a href={data.r2Url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="font-orbitron text-xs tracking-wider gap-1.5">
                  <ExternalLink className="w-3 h-3" />
                  FULL SIZE
                </Button>
              </a>
            </div>
          </div>
        </div>

        {/* Re-share bar */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <span className="font-mono-share text-[9px] text-muted-foreground/40">SHARE</span>
          <button
            onClick={handleShareTwitter}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-black/30 hover:bg-black/50 transition-colors"
          >
            <XIcon className="w-3 h-3 text-white" />
            <span className="font-mono-share text-[9px] text-white/70">Post on X</span>
          </button>
          <button
            onClick={handleShareReddit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 hover:bg-orange-500/20 transition-colors"
          >
            <RedditIcon className="w-3 h-3 text-orange-400" />
            <span className="font-mono-share text-[9px] text-orange-400/70">Reddit</span>
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, Sparkles, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareData {
  r2Url: string;
  mediaType: "image" | "video";
  prompt: string;
  createdAt: string;
}

export default function ShareView() {
  const { shareId } = useParams<{ shareId: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shareId) return;
    fetch(`/api/share?id=${encodeURIComponent(shareId)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((d) => setData(d))
      .catch(() => setError("This share link doesn't exist or has expired."))
      .finally(() => setLoading(false));
  }, [shareId]);

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
      <div className="border-b border-border/40 bg-card/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="font-orbitron text-sm tracking-wider text-primary group-hover:text-primary/80 transition-colors">
              GROK_RUNNER
            </div>
          </Link>
          <Link to="/">
            <Button size="sm" variant="outline" className="font-orbitron text-[10px] tracking-wider gap-1.5">
              <Sparkles className="w-3 h-3" />
              CREATE
            </Button>
          </Link>
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

        {/* Prompt */}
        {data.prompt && (
          <div className="mt-4 p-4 rounded-lg border border-border/30 bg-card/50">
            <div className="font-orbitron text-[10px] text-muted-foreground/60 tracking-wider mb-2">
              PROMPT
            </div>
            <p className="font-rajdhani text-sm text-foreground/80 leading-relaxed">
              {data.prompt}
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 p-4 rounded-lg border border-primary/20 bg-primary/5 text-center">
          <p className="font-mono-share text-xs text-muted-foreground mb-3">
            Made with Grok Runner — AI image & video generation
          </p>
          <div className="flex justify-center gap-2">
            <Link to="/">
              <Button className="font-orbitron text-xs tracking-wider gap-1.5">
                <Sparkles className="w-3 h-3" />
                CREATE YOUR OWN
              </Button>
            </Link>
            <a href={data.r2Url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="font-orbitron text-xs tracking-wider gap-1.5">
                <ExternalLink className="w-3 h-3" />
                OPEN FULL SIZE
              </Button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

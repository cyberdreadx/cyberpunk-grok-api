import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import CyberLayout from "@/components/CyberLayout";
import { Button } from "@/components/ui/button";
import CreatorPreviewCard from "@/components/CreatorPreviewCard";
import { apiFetch } from "@/lib/api";

interface Creator {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  verification_status: string | null;
}

export default function CreatorsDirectory() {
  const [list, setList] = useState<Creator[] | null>(null);

  useEffect(() => {
    apiFetch<{ creators: Creator[] }>("/featured-creators", { auth: false })
      .then((r) => setList(r.creators || []))
      .catch(() => setList([]));
  }, []);

  return (
    <CyberLayout>
      <main className="min-h-screen px-4 sm:px-8 py-8 max-w-6xl mx-auto">
        <div className="flex items-end justify-between gap-3 mb-6">
          <div>
            <div className="font-mono-share text-[10px] tracking-widest text-secondary">// FEATURED MODELS</div>
            <h1 className="font-orbitron text-2xl sm:text-3xl">CREATORS</h1>
          </div>
          <Link to="/apply">
            <Button size="sm" className="font-orbitron tracking-wider">BECOME A CREATOR</Button>
          </Link>
        </div>

        {list === null ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
          <div className="border border-border/40 rounded-lg p-8 text-center bg-card/30">
            <p className="font-mono-share text-sm text-muted-foreground mb-3">No featured creators yet — be the first.</p>
            <Link to="/apply"><Button>Apply now</Button></Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {list.map((c) => (
              <Link
                key={c.id}
                to={c.username ? `/profile/${c.username}` : "#"}
                className="border border-border/40 rounded-lg overflow-hidden bg-card/40 hover:border-secondary/60 transition-colors"
              >
                <div className="aspect-square bg-muted/20 flex items-center justify-center overflow-hidden">
                  {c.avatar_url ? (
                    <img src={c.avatar_url} alt={c.display_name || c.username || ""} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="font-orbitron text-3xl text-muted-foreground/40">{(c.display_name || c.username || "?").slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="p-3 space-y-1">
                  <div className="flex items-center gap-1 font-orbitron text-xs truncate">
                    {c.display_name || c.username}
                    {c.verification_status === "verified" && <BadgeCheck className="w-3 h-3 text-secondary shrink-0" />}
                  </div>
                  {c.username && (
                    <div className="font-mono-share text-[10px] text-muted-foreground truncate">@{c.username}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </CyberLayout>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CyberLayout from "@/components/CyberLayout";
import { Button } from "@/components/ui/button";
import CreatorPreviewCard from "@/components/CreatorPreviewCard";
import { Skeleton } from "@/components/ui/skeleton";
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
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
            aria-busy
            aria-label="Loading creators"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="border border-border/40 rounded-lg overflow-hidden bg-card/40"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Skeleton className="aspect-square w-full rounded-none bg-muted/30" />
                <div className="p-3 space-y-1.5">
                  <Skeleton className="h-3 w-3/4 bg-muted/30" />
                  <Skeleton className="h-2 w-1/2 bg-muted/20" />
                  <Skeleton className="h-2 w-1/3 bg-muted/15" />
                </div>
              </div>
            ))}
          </div>
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
                className="block"
              >
                <CreatorPreviewCard data={c} />
              </Link>
            ))}
          </div>
        )}
      </main>
    </CyberLayout>
  );
}

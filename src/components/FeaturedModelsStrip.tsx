import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * Horizontal strip of featured models for the front page (feed).
 * Each card links to the model's profile; if they have a fan-chat persona,
 * an AI CHAT button opens it — this is also the desktop entry point into
 * model chat (parity with the mobile bottom nav).
 */

interface Model {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  persona_chat_character_id?: string | null;
}

export default function FeaturedModelsStrip() {
  const [list, setList] = useState<Model[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch<{ creators: Model[] }>("/featured-creators", { auth: false })
      .then((r) => setList(r.creators || []))
      .catch(() => setList([]));
  }, []);

  if (!list || list.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-orbitron text-[11px] tracking-widest text-secondary">FEATURED MODELS</span>
        <span className="font-mono-share text-[8px] px-1 py-px rounded-sm tracking-widest text-emerald-300 border border-emerald-400/40 bg-emerald-400/10 animate-pulse">
          NEW
        </span>
        <button
          onClick={() => navigate("/creators")}
          className="ml-auto font-mono-share text-[9px] text-muted-foreground hover:text-secondary transition-colors"
        >
          VIEW ALL →
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {list.map((m) => {
          const name = m.display_name || m.username || "Model";
          const initial = name.slice(0, 1).toUpperCase();
          return (
            <div key={m.id} className="shrink-0 w-28 snap-start flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => m.username && navigate(`/profile/${m.username}`)}
                className="block group"
                title={`View ${name}`}
              >
                <div className="relative w-28 h-28 rounded-lg overflow-hidden border border-secondary/30 bg-card/40 group-hover:border-secondary/60 transition-colors">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={name} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-orbitron text-2xl text-secondary/50">
                      {initial}
                    </div>
                  )}
                  <span className="absolute top-1 left-1 font-mono-share text-[7px] px-1 py-px rounded-sm tracking-widest text-emerald-300 border border-emerald-400/40 bg-black/60">
                    NEW
                  </span>
                </div>
                <div className="font-mono-share text-[10px] text-foreground/90 truncate mt-1">{name}</div>
              </button>
              {m.persona_chat_character_id && (
                <button
                  type="button"
                  onClick={() => navigate(`/characters?chat=${encodeURIComponent(m.persona_chat_character_id!)}`)}
                  className="flex items-center justify-center gap-1 px-2 py-1 rounded font-orbitron text-[9px] tracking-wider border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <MessageCircle className="w-3 h-3" /> AI CHAT
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

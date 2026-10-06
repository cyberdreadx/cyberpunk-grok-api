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

  /* Compact row: each model is one tap target (profile), with a small chat
     bubble for those with an AI persona. It used to be a 112px card plus a
     full-width "AI chat" button and two "NEW" stickers — half a phone screen
     for one person. */
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">Featured models</span>
        <button
          onClick={() => navigate("/creators")}
          className="ml-auto text-xs font-medium text-muted-foreground hover:text-secondary transition-colors"
        >
          See all
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x scrollbar-hide">
        {list.map((m) => {
          const name = m.display_name || m.username || "Model";
          const initial = name.slice(0, 1).toUpperCase();
          return (
            <div key={m.id} className="shrink-0 w-[76px] snap-start">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => m.username && navigate(`/profile/${m.username}`)}
                  className="block w-[76px] h-[76px] rounded-2xl overflow-hidden border border-secondary/30 bg-card/40 hover:border-secondary/60 transition-colors"
                  title={`View ${name}`}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-display text-2xl text-secondary/60">{initial}</div>
                  )}
                </button>
                {m.persona_chat_character_id && (
                  <button
                    type="button"
                    onClick={() => navigate(`/characters?chat=${encodeURIComponent(m.persona_chat_character_id!)}`)}
                    className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center bg-primary text-primary-foreground border-2 border-background shadow"
                    aria-label={`Chat with ${name}'s AI`}
                    title="AI chat"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-xs text-foreground/85 truncate mt-1.5">{name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import PostCard from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { X, ExternalLink, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { FeedCreator } from "@/components/CreatorCard";

interface FeedPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  imageUrl: string | null;
  previewImageUrl?: string;
  previewText?: string;
  createdAt: string;
  score: number;
  userVote: string | null;
  commentCount: number;
  flagCount?: number;
  userFlagged?: boolean;
  lockCost?: number;
  lockPriceCents?: number;
  lockXrgeAmount?: string;
  unlocked?: boolean;
  isOwner?: boolean;
  viewCount?: number;
}

interface Props {
  creator: FeedCreator | null;
  onClose: () => void;
}

const CreatorPanel: React.FC<Props> = ({ creator, onClose }) => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!creator) return;
    let alive = true;
    setLoading(true);
    setPosts([]);
    apiFetch<{ posts: FeedPost[] }>(`/feed?userId=${creator.userId}&sort=new`)
      .then((d) => alive && setPosts(d.posts))
      .catch(() => alive && setPosts([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [creator]);

  if (!creator) return null;
  const initials = (creator.username || "?").slice(0, 2).toUpperCase();

  return (
    <>
      {/* Scrim (click to close) */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      />
      {/* Side panel */}
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-card border-l border-border/40 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        <header className="flex items-center justify-between gap-3 p-4 border-b border-border/30">
          <button
            onClick={() => navigate(`/profile/${creator.username}`)}
            className="flex items-center gap-3 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
          >
            <Avatar className="w-10 h-10 shrink-0">
              {creator.avatarUrl && <AvatarImage src={creator.avatarUrl} alt={creator.username} />}
              <AvatarFallback className="text-xs font-mono-share">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="font-orbitron text-sm tracking-wider text-foreground truncate">
                @{creator.username}
              </div>
              <div className="font-mono-share text-[10px] text-muted-foreground">
                {creator.postCount} posts
              </div>
            </div>
          </button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/profile/${creator.username}`)}
            className="font-mono-share text-[10px] gap-1 shrink-0"
          >
            <ExternalLink className="w-3 h-3" /> PROFILE
          </Button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : posts.length === 0 ? (
            <p className="text-center font-mono-share text-xs text-muted-foreground py-8">
              No posts yet.
            </p>
          ) : (
            posts.map((p) => <PostCard key={p.id} post={p} />)
          )}
        </div>
      </aside>
    </>
  );
};

export default CreatorPanel;

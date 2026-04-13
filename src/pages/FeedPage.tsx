import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import CyberLayout from "@/components/CyberLayout";
import PostCard from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Users, Globe, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import MobileBottomNav from "@/components/MobileBottomNav";

interface FeedPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  imageUrl: string | null;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
  userReacted: boolean;
}

const FeedPage: React.FC = () => {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "following">("all");
  const [newText, setNewText] = useState("");
  const [posting, setPosting] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchFeed = useCallback(async (cursor?: string) => {
    try {
      const params = new URLSearchParams();
      if (filter === "following") params.set("filter", "following");
      if (cursor) params.set("cursor", cursor);
      const q = params.toString();
      const data = await apiFetch<{ posts: FeedPost[]; nextCursor: string | null }>(`/feed${q ? `?${q}` : ""}`);
      if (cursor) {
        setPosts((prev) => [...prev, ...data.posts]);
      } else {
        setPosts(data.posts);
      }
      setNextCursor(data.nextCursor);
    } catch {
      toast({ title: "Failed to load feed", variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, toast]);

  

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate("/");
      return;
    }
    setLoading(true);
    fetchFeed();
  }, [authLoading, isAuthenticated, fetchFeed, navigate]);

  const handlePost = async () => {
    if (!newText.trim()) return;
    setPosting(true);
    try {
      await apiFetch("/feed", { method: "POST", body: { text: newText.trim() } });
      setNewText("");
      fetchFeed();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetchFeed(nextCursor);
  };

  return (
    <CyberLayout>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="font-orbitron text-lg tracking-widest text-foreground">LIVE FEED</h1>
          <button
            onClick={() => navigate("/profile")}
            className="font-mono-share text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            MY PROFILE →
          </button>
        </div>

        {/* Compose */}
        <div className="bg-card/60 border border-border/40 rounded-lg p-4 space-y-3">
          <Textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Share something with the community..."
            maxLength={2000}
            rows={3}
            className="font-mono-share text-sm bg-input/50 resize-none border-border/30 focus:border-primary/50"
          />
          <div className="flex items-center justify-between">
            <span className="font-mono-share text-[9px] text-muted-foreground">{newText.length}/2000</span>
            <Button size="sm" onClick={handlePost} disabled={posting || !newText.trim()} className="font-mono-share text-[10px]">
              {posting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
              POST
            </Button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono-share text-[10px] transition-colors border ${
              filter === "all"
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="w-3 h-3" /> GLOBAL
          </button>
          <button
            onClick={() => setFilter("following")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono-share text-[10px] transition-colors border ${
              filter === "following"
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-3 h-3" /> FOLLOWING
          </button>
        </div>

        {/* Posts */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="font-mono-share text-muted-foreground animate-pulse">LOADING FEED...</div>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-mono-share text-xs text-muted-foreground">
              {filter === "following" ? "Follow users to see their posts here" : "No posts yet. Be the first!"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onUpdate={() => fetchFeed()} />
            ))}
            {nextCursor && (
              <div className="flex justify-center pt-2">
                <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore} className="font-mono-share text-[10px]">
                  {loadingMore ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  LOAD MORE
                </Button>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <MobileBottomNav isAuthenticated={isAuthenticated} />
    </CyberLayout>
  );
};

export default FeedPage;

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import CyberLayout from "@/components/CyberLayout";
import PostCard from "@/components/PostCard";
import ReelCard from "@/components/ReelCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, Users, Globe, Loader2, Plus, X, Lock, Zap, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import MobileBottomNav from "@/components/MobileBottomNav";

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
}

const FEED_RULES = [
  "No illegal content of any kind",
  "No underage or child exploitation content — zero tolerance",
  "No non-consensual intimate imagery (real or AI-generated)",
  "No doxxing, harassment, threats, or incitement of violence",
  "No spam, scams, phishing, or malicious links",
  "No impersonation of other users or public figures",
  "No promotion of self-harm, terrorism, or hate speech",
  "No posting of copyrighted content you don't own",
];

const FeedPage: React.FC = () => {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [rulesAcked, setRulesAcked] = useState(() => localStorage.getItem("feed-rules-acked") === "1");

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "following">("all");
  const [newText, setNewText] = useState("");
  const [posting, setPosting] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockCredits, setLockCredits] = useState("");
  const [lockPrice, setLockPrice] = useState("");
  const [lockXrge, setLockXrge] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const body: any = { text: newText.trim() };
      if (lockEnabled) {
        if (lockCredits) body.lockCost = parseInt(lockCredits) || 0;
        if (lockPrice) body.lockPriceCents = Math.round(parseFloat(lockPrice) * 100) || 0;
        if (lockXrge) body.lockXrgeAmount = lockXrge;
      }
      await apiFetch("/feed", { method: "POST", body });
      setNewText("");
      setShowCompose(false);
      setLockEnabled(false);
      setLockCredits("");
      setLockPrice("");
      setLockXrge("");
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

  const handleReelScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !nextCursor || loadingMore) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 400;
    if (nearBottom) {
      setLoadingMore(true);
      fetchFeed(nextCursor);
    }
  }, [nextCursor, loadingMore, fetchFeed]);

  const lockControls = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch checked={lockEnabled} onCheckedChange={setLockEnabled} />
        <span className="font-mono-share text-[10px] text-muted-foreground flex items-center gap-1">
          <Lock className="w-3 h-3" /> Lock this post
        </span>
      </div>
      {lockEnabled && (
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[80px]">
            <label className="font-mono-share text-[9px] text-muted-foreground block mb-1">Credits</label>
            <Input
              type="number"
              min="0"
              max="100"
              placeholder="e.g. 5"
              value={lockCredits}
              onChange={(e) => setLockCredits(e.target.value)}
              className="font-mono-share text-xs h-8"
            />
          </div>
          <div className="flex-1 min-w-[80px]">
            <label className="font-mono-share text-[9px] text-muted-foreground block mb-1">USD ($)</label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="e.g. 2.99"
              value={lockPrice}
              onChange={(e) => setLockPrice(e.target.value)}
              className="font-mono-share text-xs h-8"
            />
          </div>
          <div className="flex-1 min-w-[80px]">
            <label className="font-mono-share text-[9px] text-muted-foreground flex items-center gap-1 block mb-1">
              <Zap className="w-3 h-3 text-secondary" /> XRGE
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 100"
              value={lockXrge}
              onChange={(e) => setLockXrge(e.target.value)}
              className="font-mono-share text-xs h-8"
            />
          </div>
        </div>
      )}
    </div>
  );

  /* ───── MOBILE REELS VIEW ───── */
  if (isMobile) {
    return (
      <>
        <div
          ref={scrollRef}
          onScroll={handleReelScroll}
          className="fixed inset-0 z-0 overflow-y-auto snap-y snap-mandatory bg-black"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {loading ? (
            <div className="h-[100dvh] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : posts.length === 0 ? (
            <div className="h-[100dvh] flex items-center justify-center">
              <p className="font-mono-share text-xs text-muted-foreground">
                {filter === "following" ? "Follow users to see their posts here" : "No posts yet. Be the first!"}
              </p>
            </div>
          ) : (
            <>
              {posts.map((post) => (
                <ReelCard key={post.id} post={post} onUpdate={() => fetchFeed()} />
              ))}
              {loadingMore && (
                <div className="h-[100dvh] snap-start flex items-center justify-center bg-black">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              )}
            </>
          )}
        </div>

        {/* Top bar overlay */}
        <div
          className="fixed left-0 right-0 z-40 flex items-center justify-between px-4"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
        >
          <h1 className="font-orbitron text-sm tracking-widest text-white drop-shadow-lg">FEED</h1>
          <div className="flex gap-1.5">
            <button
              onClick={() => { setFilter("all"); setLoading(true); }}
              className={`px-2.5 py-1 rounded-full font-mono-share text-[9px] backdrop-blur-sm transition-colors ${
                filter === "all"
                  ? "bg-primary/30 text-primary border border-primary/40"
                  : "bg-black/30 text-white/70 border border-white/10"
              }`}
            >
              ALL
            </button>
            <button
              onClick={() => { setFilter("following"); setLoading(true); }}
              className={`px-2.5 py-1 rounded-full font-mono-share text-[9px] backdrop-blur-sm transition-colors ${
                filter === "following"
                  ? "bg-primary/30 text-primary border border-primary/40"
                  : "bg-black/30 text-white/70 border border-white/10"
              }`}
            >
              FOLLOWING
            </button>
          </div>
        </div>

        {/* Floating compose button */}
        <button
          onClick={() => setShowCompose(true)}
          className="fixed z-40 right-4 bg-primary text-primary-foreground w-12 h-12 rounded-full flex items-center justify-center shadow-lg shadow-primary/30 active:scale-90 transition-transform"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
        >
          <Plus className="w-6 h-6" />
        </button>

        {/* Compose sheet */}
        {showCompose && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[env(safe-area-inset-top,0px)]" onClick={() => setShowCompose(false)}>
            <div
              className="w-[calc(100%-32px)] mt-16 bg-card rounded-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-200 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <span className="font-orbitron text-xs text-foreground tracking-wider">NEW POST</span>
                <button onClick={() => setShowCompose(false)} className="text-muted-foreground p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <Textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Share something..."
                maxLength={2000}
                rows={3}
                autoFocus
                className="font-mono-share text-sm bg-input/50 resize-none border-border/30 focus:border-primary/50"
              />
              {lockControls}
              <div className="flex items-center justify-between">
                <span className="font-mono-share text-[9px] text-muted-foreground">{newText.length}/2000</span>
                <Button size="sm" onClick={handlePost} disabled={posting || !newText.trim()} className="font-mono-share text-[10px]">
                  {posting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                  POST
                </Button>
              </div>
            </div>
          </div>
        )}

        <MobileBottomNav isAuthenticated={isAuthenticated} />
      </>
    );
  }

  /* ───── DESKTOP VIEW ───── */
  return (
    <CyberLayout>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="font-orbitron text-lg tracking-widest text-foreground">LIVE FEED</h1>
          <button
            onClick={() => navigate("/profile")}
            className="font-mono-share text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            MY PROFILE →
          </button>
        </div>

        <div className="bg-card/60 border border-border/40 rounded-lg p-4 space-y-3">
          <Textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Share something with the community..."
            maxLength={2000}
            rows={3}
            className="font-mono-share text-sm bg-input/50 resize-none border-border/30 focus:border-primary/50"
          />
          {lockControls}
          <div className="flex items-center justify-between">
            <span className="font-mono-share text-[9px] text-muted-foreground">{newText.length}/2000</span>
            <Button size="sm" onClick={handlePost} disabled={posting || !newText.trim()} className="font-mono-share text-[10px]">
              {posting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
              POST
            </Button>
          </div>
        </div>

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

        {loading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card/60 border border-border/40 rounded-lg p-4 space-y-3 animate-in fade-in duration-300" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="flex items-center gap-3">
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-24 rounded" />
                    <Skeleton className="h-2 w-16 rounded" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full rounded" />
                  <Skeleton className="h-3 w-3/4 rounded" />
                </div>
                {i % 2 === 0 && <Skeleton className="h-40 w-full rounded" />}
                <div className="flex items-center gap-4 pt-1">
                  <Skeleton className="h-4 w-16 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
              </div>
            ))}
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
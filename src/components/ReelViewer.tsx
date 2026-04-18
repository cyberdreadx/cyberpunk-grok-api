import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import ReelCard from "@/components/ReelCard";

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
  open: boolean;
  onClose: () => void;
  /** Initial post id to focus. */
  initialPostId: string;
  /** Optional creator filter — only show this user's posts. */
  userId?: string;
  /** Optional follow/all filter passthrough. */
  filter?: "all" | "following";
}

/**
 * Full-screen TikTok-style reel viewer. Vertical snap-scroll between posts,
 * fetches the same /feed listing the page uses, ensures the initial post is
 * present, and lazy-loads more on scroll-to-end.
 */
const ReelViewer: React.FC<Props> = ({ open, onClose, initialPostId, userId, filter }) => {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const buildUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams({ sort: "new" });
    if (userId) params.set("userId", userId);
    else if (filter === "following") params.set("filter", "following");
    if (cursor) params.set("cursor", cursor);
    return `/feed?${params.toString()}`;
  }, [userId, filter]);

  // Initial fetch — ensure initial post is in the list (prepend if missing).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setPosts([]);
    setNextCursor(null);

    (async () => {
      try {
        const data = await apiFetch<{ posts: FeedPost[]; nextCursor: string | null }>(buildUrl());
        if (!alive) return;
        const list = data.posts || [];
        setPosts(list);
        setNextCursor(data.nextCursor);
      } catch {
        setPosts([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [open, initialPostId, buildUrl]);

  // Scroll to the initial post once posts are rendered.
  useEffect(() => {
    if (!open || loading || !initialPostId) return;
    const el = itemRefs.current[initialPostId];
    if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
  }, [open, loading, initialPostId]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Infinite scroll — load more when near the bottom.
  const onScroll = useCallback(() => {
    const c = containerRef.current;
    if (!c || !nextCursor || loadingMore) return;
    if (c.scrollTop + c.clientHeight >= c.scrollHeight - 800) {
      setLoadingMore(true);
      apiFetch<{ posts: FeedPost[]; nextCursor: string | null }>(buildUrl(nextCursor))
        .then((d) => {
          setPosts((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            return [...prev, ...(d.posts || []).filter((p) => !seen.has(p.id))];
          });
          setNextCursor(d.nextCursor);
        })
        .catch(() => {})
        .finally(() => setLoadingMore(false));
    }
  }, [buildUrl, loadingMore, nextCursor]);

  // Desktop arrow nav helpers
  const scrollByOne = (dir: 1 | -1) => {
    const c = containerRef.current;
    if (!c) return;
    c.scrollBy({ top: dir * c.clientHeight, behavior: "smooth" });
  };

  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-[100] bg-black">
      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="fixed top-3 right-3 z-[110] p-2 rounded-full bg-black/50 text-white/90 hover:bg-black/70 backdrop-blur-sm"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <X className="w-5 h-5" />
      </button>

      {/* Desktop nav arrows */}
      <button
        onClick={() => scrollByOne(-1)}
        aria-label="Previous"
        className="hidden md:flex fixed right-3 top-1/2 -translate-y-[60px] z-[110] p-2 rounded-full bg-black/50 text-white/90 hover:bg-black/70 backdrop-blur-sm"
      >
        <ChevronUp className="w-5 h-5" />
      </button>
      <button
        onClick={() => scrollByOne(1)}
        aria-label="Next"
        className="hidden md:flex fixed right-3 top-1/2 translate-y-2 z-[110] p-2 rounded-full bg-black/50 text-white/90 hover:bg-black/70 backdrop-blur-sm"
      >
        <ChevronDown className="w-5 h-5" />
      </button>

      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : posts.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-mono-share text-xs text-white/60">No posts to show</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          onScroll={onScroll}
          className="h-[100dvh] w-full overflow-y-auto snap-y snap-mandatory overscroll-contain"
          style={{ scrollbarWidth: "none" }}
        >
          {posts.map((p) => (
            <div
              key={p.id}
              ref={(el) => { itemRefs.current[p.id] = el; }}
            >
              <ReelCard post={p} />
            </div>
          ))}
          {loadingMore && (
            <div className="h-16 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(node, document.body);
};

export default ReelViewer;

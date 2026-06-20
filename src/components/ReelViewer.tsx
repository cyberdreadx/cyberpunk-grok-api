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
  initialPostId: string;
  userId?: string;
  filter?: "all" | "following" | "trending";
  /** When "video", only video posts are loaded (TikTok-style reels mode). */
  mediaType?: "video";
}

/** How many slides to keep mounted on each side of the active one. */
const WINDOW_RADIUS = 1;

const getNearestSlideIndex = (container: HTMLDivElement, items: (HTMLDivElement | null)[]) => {
  const containerTop = container.getBoundingClientRect().top;
  let bestIdx = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  items.forEach((el, idx) => {
    if (!el) return;
    const distance = Math.abs(el.getBoundingClientRect().top - containerTop);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIdx = idx;
    }
  });

  return bestIdx;
};

/**
 * Full-screen TikTok-style reel viewer. Virtualized: only the active slide
 * (and ±1 neighbours as placeholders) renders heavy media, so memory + decode
 * cost stays flat as the feed grows.
 */
const ReelViewer: React.FC<Props> = ({ open, onClose, initialPostId, userId, filter, mediaType }) => {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // Shared mute state across all reels — starts muted (autoplay), tap any reel's button to hear sound.
  const [muted, setMuted] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollSettleTimerRef = useRef<number | null>(null);

  const buildUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams({ sort: filter === "trending" ? "trending" : "new" });
    if (userId) params.set("userId", userId);
    else if (filter === "following") params.set("filter", "following");
    if (mediaType) params.set("mediaType", mediaType);
    if (cursor) params.set("cursor", cursor);
    return `/feed?${params.toString()}`;
  }, [userId, filter, mediaType]);

  // Initial fetch
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setPosts([]);
    setNextCursor(null);
    setActiveIdx(0);

    (async () => {
      try {
        const data = await apiFetch<{ posts: FeedPost[]; nextCursor: string | null }>(buildUrl());
        if (!alive) return;
        const list = data.posts || [];
        setPosts(list);
        setNextCursor(data.nextCursor);
        const idx = initialPostId ? list.findIndex((p) => p.id === initialPostId) : 0;
        setActiveIdx(idx >= 0 ? idx : 0);
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
    if (!open || loading || posts.length === 0) return;
    const el = itemRefs.current[activeIdx];
    if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
    // Only run when posts list first populates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, posts.length]);

  // Track which slide is active; snap scrolling can produce observer gaps, so
  // settle to the nearest slide after scroll stops.
  useEffect(() => {
    if (!open || loading || posts.length === 0) return;
    const root = containerRef.current;
    if (!root) return;
    const syncActiveFromScroll = () => {
      if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = window.setTimeout(() => {
        setActiveIdx(getNearestSlideIndex(root, itemRefs.current));
      }, 90);
    };
    const io = new IntersectionObserver(
      (entries) => {
        // Pick the most-visible entry.
        let best: IntersectionObserverEntry | null = null;
        for (const e of entries) {
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
        }
        if (best && best.isIntersecting) {
          const idx = itemRefs.current.findIndex((el) => el === best!.target);
          if (idx >= 0) setActiveIdx(idx);
        }
      },
      { root, threshold: [0.25, 0.5, 0.75] }
    );
    itemRefs.current.forEach((el) => el && io.observe(el));
    root.addEventListener("scroll", syncActiveFromScroll, { passive: true });
    return () => {
      io.disconnect();
      root.removeEventListener("scroll", syncActiveFromScroll);
      if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
    };
  }, [open, loading, posts.length]);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Infinite scroll — load more when active is near the end.
  useEffect(() => {
    if (!nextCursor || loadingMore) return;
    if (activeIdx < posts.length - 3) return;
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
  }, [activeIdx, posts.length, nextCursor, loadingMore, buildUrl]);

  const scrollByOne = (dir: 1 | -1) => {
    const c = containerRef.current;
    if (!c) return;
    c.scrollBy({ top: dir * c.clientHeight, behavior: "smooth" });
  };

  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-[100] bg-black">
      <button
        onClick={onClose}
        aria-label="Close"
        className="fixed top-3 right-3 z-[110] p-2 rounded-full bg-black/50 text-white/90 hover:bg-black/70 backdrop-blur-sm"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <X className="w-5 h-5" />
      </button>

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
          className="h-[100dvh] w-full overflow-y-auto snap-y snap-mandatory overscroll-contain"
          style={{ scrollbarWidth: "none" }}
        >
          {posts.map((p, i) => {
            const distance = Math.abs(i - activeIdx);
            const shouldMount = distance <= WINDOW_RADIUS;
            const isActive = i === activeIdx;
            return (
              <div
                key={p.id}
                ref={(el) => { itemRefs.current[i] = el; }}
                className="h-[100dvh] snap-start snap-always"
              >
                {shouldMount ? (
                  <ReelCard post={p} active={isActive} mountMedia muted={muted} onToggleMuted={() => setMuted((m) => !m)} />
                ) : (
                  // Lightweight placeholder — keeps scroll height correct without
                  // mounting media / spawning DOM trees for off-screen slides.
                  <div className="w-full h-full bg-black" />
                )}
              </div>
            );
          })}
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

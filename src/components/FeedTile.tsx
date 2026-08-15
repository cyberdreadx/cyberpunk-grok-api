import React, { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Lock, ImageIcon, Heart, MessageSquare, ShieldAlert, Film } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useMatureFilter } from "@/hooks/useMatureFilter";
import { extractPoster, getCachedPoster } from "@/lib/videoPoster";
import { useMediaSrc } from "@/hooks/useMediaSrc";

/** Minimal post shape consumed by the content-first feed grid. Mirrors the
 *  `posts[]` returned by GET /api/feed?view=posts. */
export interface FeedTilePost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  authorVerified?: boolean;
  text: string;
  imageUrl: string | null;
  previewImageUrl?: string;
  createdAt: string;
  score: number;
  commentCount: number;
  // Returned by the API for every post; the grid ignores them, the text lane
  // (TextPostCard) renders them.
  userVote?: string | null;
  viewCount?: number;
  previewText?: string;
  isMature?: boolean;
  isOwner?: boolean;
  unlocked?: boolean;
  lockCost?: number;
  lockPriceCents?: number;
  lockXrgeAmount?: string;
}

interface Props {
  post: FeedTilePost;
  onOpen: (p: FeedTilePost) => void;
  /** When true, blur all previews regardless of lock state (logged-out teaser). */
  forceBlur?: boolean;
  /** Logged-in user id — owners never see their own posts blurred. */
  currentUserId?: string | null;
}

const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

const FeedTile: React.FC<Props> = ({ post, onOpen, forceBlur, currentUserId }) => {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(false);
  const { matureFilter } = useMatureFilter();

  const isOwner = post.isOwner ?? (!!currentUserId && currentUserId === post.userId);
  const xrge = post.lockXrgeAmount ? parseFloat(post.lockXrgeAmount) : 0;
  const isLocked =
    !post.unlocked && !isOwner &&
    ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0 || xrge > 0);

  // A tile wants a still, not the media itself.
  //
  // For video, prefer the server-generated first frame: pointing the tile at
  // the .mp4 means every visible tile downloads a video and canvas-extracts a
  // frame, which is slow enough to time out — the tile then sits at opacity-0
  // and the grid looks like it has no thumbnails at all.
  //
  // For images we still prefer the original, because the derived
  // -preview.webp URL 404s on anything posted before that convention existed.
  const fullIsVideo = isVideoUrl(post.imageUrl || "");
  // When locked, the API already swaps imageUrl for the blurred preview.
  const previewImg = forceBlur
    ? post.previewImageUrl
    : fullIsVideo
      ? (post.previewImageUrl || post.imageUrl)
      : (post.imageUrl || post.previewImageUrl);
  const initials = (post.username || "?").slice(0, 2).toUpperCase();
  const isMatureBlur = !!post.isMature && matureFilter && !isLocked && !isOwner;
  const showLocked = isLocked || forceBlur;
  const showBlur = showLocked || isMatureBlur;
  // Whether the thing we're about to render is itself a video — false once a
  // still preview is in hand, even though the post is still a video post.
  const isVideo = !!previewImg && isVideoUrl(previewImg);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const { src: activeSrc, onError: handleMediaError, failed: mediaFailed } = useMediaSrc(previewImg, {
    kind: isVideo ? "video" : "image",
    context: "feed-tile",
  });

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const [poster, setPoster] = useState<string | null>(() =>
    isVideo && previewImg ? (getCachedPoster(previewImg) ?? null) : null
  );

  useEffect(() => {
    if (!inView || !isVideo || !previewImg) return;
    if (getCachedPoster(previewImg) !== undefined) return;
    let cancelled = false;
    extractPoster(previewImg).then((p) => { if (!cancelled) setPoster(p); });
    return () => { cancelled = true; };
  }, [inView, isVideo, previewImg]);

  const showSkeleton = !!previewImg && !mediaFailed && !mediaLoaded;

  return (
    <button
      ref={cardRef}
      onClick={() => onOpen(post)}
      className="group relative w-full text-left overflow-hidden rounded-lg border border-border/40 bg-card/60 transition-all aspect-[3/4] flex flex-col hover:border-primary/40"
    >
      {/* Preview */}
      <div className="relative flex-1 bg-muted/30 overflow-hidden">
        {showSkeleton && <div className="skeleton-cyber absolute inset-0" aria-hidden />}
        {previewImg && !mediaFailed ? (
          isVideo ? (
            poster ? (
              <img
                src={poster}
                alt={`${post.username}'s post`}
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-105 ${showBlur ? "blur-2xl scale-110" : ""} ${mediaLoaded ? "opacity-100" : "opacity-0"}`}
                onLoad={() => setMediaLoaded(true)}
                onError={() => setPoster(null)}
              />
            ) : (
              <video
                key={activeSrc}
                src={`${activeSrc}${activeSrc.includes("#") ? "" : "#t=0.1"}`}
                muted
                playsInline
                // @ts-ignore - iOS Safari attribute
                webkit-playsinline="true"
                preload="metadata"
                className={`w-full h-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-105 ${showBlur ? "blur-2xl scale-110" : ""} ${mediaLoaded ? "opacity-100" : "opacity-0"}`}
                // `loadeddata` needs HAVE_CURRENT_DATA, which preload="metadata"
                // is not obliged to reach — relying on it alone leaves the tile
                // at opacity-0 forever. `loadedmetadata` always fires, so treat
                // either as "safe to show".
                onLoadedMetadata={() => setMediaLoaded(true)}
                onLoadedData={() => setMediaLoaded(true)}
                onError={handleMediaError}
              />
            )
          ) : (
            <img
              key={activeSrc}
              src={activeSrc}
              alt={`${post.username}'s post`}
              loading="lazy"
              decoding="async"
              className={`w-full h-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-105 ${showBlur ? "blur-2xl scale-110" : ""} ${mediaLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setMediaLoaded(true)}
              onError={handleMediaError}
            />
          )
        ) : post.text ? (
          <div className="absolute inset-0 p-3 flex items-center justify-center">
            <p className={`font-mono-share text-[11px] text-foreground/80 line-clamp-6 text-center leading-snug ${forceBlur || isMatureBlur ? "blur-sm select-none" : ""}`}>
              {post.text}
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}

        {showLocked && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/60 backdrop-blur-sm rounded-full p-2 border border-primary/40">
              <Lock className="w-4 h-4 text-primary" />
            </div>
          </div>
        )}

        {isMatureBlur && !showLocked && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/60 backdrop-blur-sm rounded-full px-2 py-1 border border-amber-400/50 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-amber-300" />
              <span className="font-mono-share text-[9px] text-amber-200 tracking-wider">18+</span>
            </div>
          </div>
        )}

        {/* Keyed off the post, not the rendered element — a video post still
            earns the film badge once we're showing its still frame. */}
        {fullIsVideo && !mediaFailed && (
          <div className="absolute top-2 left-2 px-1 py-0.5 rounded bg-black/60 backdrop-blur-sm flex items-center gap-1">
            <Film className="w-2.5 h-2.5 text-white/90" />
          </div>
        )}

        {/* Owner-only LOCKED · price badge */}
        {isOwner && ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0 || xrge > 0) && (
          <div
            className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm border border-amber-400/50 font-mono-share text-[9px] text-amber-300 tracking-wider"
            title="Locked for other viewers — they see a blurred preview and must unlock."
          >
            <Lock className="w-2.5 h-2.5" />
            <span>LOCKED ·</span>
            {(post.lockCost || 0) > 0 && <span>{post.lockCost}c</span>}
            {(post.lockPriceCents || 0) > 0 && <span>${((post.lockPriceCents || 0) / 100).toFixed(2)}</span>}
            {xrge > 0 && <span>{post.lockXrgeAmount} XRGE</span>}
          </div>
        )}

        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm font-mono-share text-[9px] text-white/90">
          {timeAgo(post.createdAt)}
        </div>
      </div>

      {/* Footer: avatar + name + engagement */}
      <div className="flex items-center gap-2 p-2 bg-card/80 border-t border-border/30">
        <Avatar className="w-7 h-7 shrink-0">
          {post.avatarUrl && <AvatarImage src={post.avatarUrl} alt={post.username} />}
          <AvatarFallback className="text-[9px] font-mono-share bg-muted">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-mono-share text-[11px] text-foreground truncate flex items-center gap-1">
            <span className="truncate">@{post.username}</span>
            {post.authorVerified && <VerifiedBadge size="xs" />}
          </div>
          <div className="font-mono-share text-[9px] text-muted-foreground flex items-center gap-2">
            <span className="flex items-center gap-0.5"><Heart className="w-2.5 h-2.5" />{post.score ?? 0}</span>
            <span className="flex items-center gap-0.5"><MessageSquare className="w-2.5 h-2.5" />{post.commentCount ?? 0}</span>
          </div>
        </div>
      </div>
    </button>
  );
};

export default FeedTile;

import React, { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Lock, ImageIcon, MessageSquare, ShieldAlert, Film } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useMatureFilter } from "@/hooks/useMatureFilter";
import { extractPoster, getCachedPoster } from "@/lib/videoPoster";
import { mediaCandidates } from "@/lib/mediaUrl";
import { reportMediaError } from "@/lib/mediaErrorReporter";

export interface FeedCreator {
  userId: string;
  username: string;
  avatarUrl: string | null;
  postCount: number;
  recentScore: number;
  latestPostId: string;
  latestText: string;
  latestImage: string | null;
  previewImage?: string;
  latestAt: string;
  latestLocked: boolean;
  verified?: boolean;
  isMature?: boolean;
  isOwner?: boolean;
  lockCost?: number;
  lockPriceCents?: number;
  lockXrgeAmount?: string;
}

interface Props {
  creator: FeedCreator;
  onOpen: (c: FeedCreator) => void;
  active?: boolean;
  /** When true, blur all previews regardless of lock state (used for logged-out teaser). */
  forceBlur?: boolean;
  /** Currently logged-in user id — owners never see their own posts blurred for maturity. */
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

const CreatorCard: React.FC<Props> = ({ creator, onOpen, active, forceBlur, currentUserId }) => {
  const previewImg = creator.latestImage || creator.previewImage;
  const initials = (creator.username || "?").slice(0, 2).toUpperCase();
  const { matureFilter } = useMatureFilter();
  const isOwner = !!currentUserId && currentUserId === creator.userId;
  const isMatureBlur = !!creator.isMature && matureFilter && !creator.latestLocked && !isOwner;
  const showLocked = creator.latestLocked || forceBlur;
  const showBlur = showLocked || isMatureBlur;
  const isVideo = !!previewImg && isVideoUrl(previewImg);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [srcIdx, setSrcIdx] = useState(0);
  const candidates = previewImg ? mediaCandidates(previewImg) : [];
  const activeSrc = candidates[srcIdx] || previewImg || "";

  const handleMediaError = () => {
    // Report the URL that just failed (not the whole chain) so the dashboard
    // can spot the actual broken host/extension.
    if (activeSrc) reportMediaError(activeSrc, isVideo ? "video" : "image", "feed-card");
    if (srcIdx < candidates.length - 1) {
      setSrcIdx((i) => i + 1);
    } else {
      setMediaFailed(true);
    }
  };

  const [poster, setPoster] = useState<string | null>(() =>
    isVideo && previewImg ? (getCachedPoster(previewImg) ?? null) : null
  );

  // Lazily extract a frame from the video to use as a stable poster image.
  // If extraction fails (CORS, codec) we silently fall back to the inline <video>.
  useEffect(() => {
    if (!isVideo || !previewImg) return;
    if (getCachedPoster(previewImg) !== undefined) return;
    let cancelled = false;
    extractPoster(previewImg).then((p) => { if (!cancelled) setPoster(p); });
    return () => { cancelled = true; };
  }, [isVideo, previewImg]);

  const showSkeleton = !!previewImg && !mediaFailed && !mediaLoaded;

  return (
    <button
      onClick={() => onOpen(creator)}
      className={`group relative w-full text-left overflow-hidden rounded-lg border bg-card/60 transition-all aspect-[3/4] flex flex-col ${
        active
          ? "border-primary/60 ring-1 ring-primary/40"
          : "border-border/40 hover:border-primary/40"
      }`}
    >
      {/* Preview */}
      <div className="relative flex-1 bg-muted/30 overflow-hidden">
        {/* Skeleton shimmer while media resolves */}
        {showSkeleton && (
          <div className="skeleton-cyber absolute inset-0" aria-hidden />
        )}
        {previewImg && !mediaFailed ? (
          isVideo ? (
            poster ? (
              <img
                src={poster}
                alt={`${creator.username}'s latest`}
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-105 ${
                  showBlur ? "blur-2xl scale-110" : ""
                } ${mediaLoaded ? "opacity-100" : "opacity-0"}`}
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
                className={`w-full h-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-105 ${
                  showBlur ? "blur-2xl scale-110" : ""
                } ${mediaLoaded ? "opacity-100" : "opacity-0"}`}
                onLoadedData={() => setMediaLoaded(true)}
                onError={handleMediaError}
              />
            )
          ) : (
            <img
              key={activeSrc}
              src={activeSrc}
              alt={`${creator.username}'s latest`}
              loading="lazy"
              decoding="async"
              className={`w-full h-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-105 ${
                showBlur ? "blur-2xl scale-110" : ""
              } ${mediaLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setMediaLoaded(true)}
              onError={handleMediaError}
            />
          )
        ) : creator.latestText ? (
          <div className="absolute inset-0 p-3 flex items-center justify-center">
            <p className={`font-mono-share text-[11px] text-foreground/80 line-clamp-6 text-center leading-snug ${forceBlur || isMatureBlur ? "blur-sm select-none" : ""}`}>
              {creator.latestText}
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

        {/* Video indicator */}
        {isVideo && !mediaFailed && (
          <div className="absolute top-2 left-2 px-1 py-0.5 rounded bg-black/60 backdrop-blur-sm flex items-center gap-1">
            <Film className="w-2.5 h-2.5 text-white/90" />
          </div>
        )}

        {/* Time chip */}
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm font-mono-share text-[9px] text-white/90">
          {timeAgo(creator.latestAt)}
        </div>
      </div>

      {/* Footer: avatar + name */}
      <div className="flex items-center gap-2 p-2 bg-card/80 border-t border-border/30">
        <Avatar className="w-7 h-7 shrink-0">
          {creator.avatarUrl && <AvatarImage src={creator.avatarUrl} alt={creator.username} />}
          <AvatarFallback className="text-[9px] font-mono-share bg-muted">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-mono-share text-[11px] text-foreground truncate flex items-center gap-1">
            <span className="truncate">@{creator.username}</span>
            {creator.verified && <VerifiedBadge size="xs" />}
          </div>
          <div className="font-mono-share text-[9px] text-muted-foreground flex items-center gap-1">
            <MessageSquare className="w-2.5 h-2.5" />
            {creator.postCount} {creator.postCount === 1 ? "post" : "posts"}
          </div>
        </div>
      </div>
    </button>
  );
};

export default CreatorCard;

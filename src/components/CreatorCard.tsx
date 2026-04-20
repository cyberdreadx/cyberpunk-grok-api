import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Lock, ImageIcon, MessageSquare } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";

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
}

interface Props {
  creator: FeedCreator;
  onOpen: (c: FeedCreator) => void;
  active?: boolean;
  /** When true, blur all previews regardless of lock state (used for logged-out teaser). */
  forceBlur?: boolean;
}

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

const isVideoUrl = (u?: string | null) => !!u && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);

const CreatorCard: React.FC<Props> = ({ creator, onOpen, active, forceBlur }) => {
  const previewImg = creator.latestImage || creator.previewImage;
  const initials = (creator.username || "?").slice(0, 2).toUpperCase();
  const showLocked = creator.latestLocked || forceBlur;
  const previewIsVideo = isVideoUrl(previewImg);

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
        {previewImg ? (
          previewIsVideo ? (
            <video
              src={previewImg}
              muted
              loop
              playsInline
              // @ts-expect-error vendor attr for iOS Safari
              webkit-playsinline="true"
              preload="metadata"
              autoPlay
              className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${
                showLocked ? "blur-2xl scale-110" : ""
              }`}
            />
          ) : (
            <img
              src={previewImg}
              alt={`${creator.username}'s latest`}
              loading="lazy"
              decoding="async"
              className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${
                showLocked ? "blur-2xl scale-110" : ""
              }`}
            />
          )
        ) : creator.latestText ? (
          <div className="absolute inset-0 p-3 flex items-center justify-center">
            <p className={`font-mono-share text-[11px] text-foreground/80 line-clamp-6 text-center leading-snug ${forceBlur ? "blur-sm select-none" : ""}`}>
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

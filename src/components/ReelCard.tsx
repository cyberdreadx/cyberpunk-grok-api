import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Trash2, Flag, Lock, Coins, CreditCard, Zap, Eye, EyeOff, MoreHorizontal, Link2, ShieldOff, Volume2, VolumeX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CommentThread from "@/components/CommentThread";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import XrgeUnlockDialog from "@/components/XrgeUnlockDialog";
import { useMatureFilter } from "@/hooks/useMatureFilter";
import { useMediaSrc } from "@/hooks/useMediaSrc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  isMature?: boolean;
}

interface ReelCardProps {
  post: FeedPost;
  onUpdate?: () => void;
  /** Whether this card is currently in view — controls video play/pause + bg layers. */
  active?: boolean;
  /** Whether to mount media at all (for virtualization). Defaults to true. */
  mountMedia?: boolean;
  /** Global mute state for the reels feed (shared across cards). */
  muted?: boolean;
  /** Toggle the global mute state. */
  onToggleMuted?: () => void;
}

const ReelCard: React.FC<ReelCardProps> = ({ post, onUpdate, active = true, mountMedia = true, muted = true, onToggleMuted }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { matureFilter } = useMatureFilter();
  const [score, setScore] = useState(post.score ?? 0);
  const [userVote, setUserVote] = useState<string | null>(post.userVote);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [deleting, setDeleting] = useState(false);
  const [flagCount, setFlagCount] = useState(post.flagCount ?? 0);
  const [userFlagged, setUserFlagged] = useState(post.userFlagged ?? false);
  const [flagging, setFlagging] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(post.unlocked ?? true);
  const [matureRevealed, setMatureRevealed] = useState(false);
  const [matureFlagged, setMatureFlagged] = useState(!!post.isMature);
  const [togglingMature, setTogglingMature] = useState(false);

  // Sync unlock state when props change (e.g. after fetchFeed refresh)
  React.useEffect(() => {
    if (post.unlocked !== undefined) setIsUnlocked(post.unlocked);
  }, [post.unlocked]);
  const [xrgeUnlockOpen, setXrgeUnlockOpen] = useState(false);

  const isLocked = !isUnlocked && !post.isOwner && ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0 || !!(post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0));
  const isTeaser = !isLocked && !post.imageUrl && !!post.previewImageUrl;
  const isVideo = post.imageUrl ? /\.(mp4|webm|mov)(\?|$)/i.test(post.imageUrl) || post.imageUrl.includes("video") : false;
  const mainMedia = useMediaSrc(post.imageUrl, { kind: isVideo ? "video" : "image", context: "reel-card" });
  const previewMedia = useMediaSrc(post.previewImageUrl, { context: "reel-preview" });
  const mediaFailed = mainMedia.failed;
  const isMatureBlurred = !isLocked && matureFilter && !!post.isMature && !matureRevealed && !post.isOwner;
  const isAdminOrMod = !!user?.is_admin || !!user?.is_feed_mod;
  const canDelete = user?.id === post.userId || isAdminOrMod;
  const canToggleMature = user?.id === post.userId || isAdminOrMod;

  const handleToggleMature = async () => {
    if (togglingMature) return;
    const next = !matureFlagged;
    setTogglingMature(true);
    setMatureFlagged(next);
    try {
      await apiFetch("/feed", { method: "PATCH", body: { postId: post.id, action: "set-mature", isMature: next } });
      toast({ title: next ? "Marked as 18+" : "Removed 18+ tag" });
      onUpdate?.();
    } catch (err: any) {
      setMatureFlagged(!next);
      toast({ title: err.message || "Failed to update", variant: "destructive" });
    } finally {
      setTogglingMature(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      // publicUrl (gltchrunner.com) — *.gltch.app is blocked on Reddit/X.
      await navigator.clipboard.writeText(`${BRAND.publicUrl}/feed?post=${post.id}`);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleAdminBan = async () => {
    if (!confirm(`Ban @${post.username}?`)) return;
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "ban-user", userId: post.userId, reason: "Banned via reels moderation" } });
      toast({ title: "User banned" });
      onUpdate?.();
    } catch (err: any) {
      toast({ title: err.message || "Failed", variant: "destructive" });
    }
  };

  const handleVote = async (emoji: "👍" | "👎") => {
    if (isLocked) return;
    const prevScore = score;
    const prevVote = userVote;
    if (userVote === emoji) {
      setUserVote(null);
      setScore(s => emoji === "👍" ? s - 1 : s + 1);
    } else if (userVote) {
      setUserVote(emoji);
      setScore(s => emoji === "👍" ? s + 2 : s - 2);
    } else {
      setUserVote(emoji);
      setScore(s => emoji === "👍" ? s + 1 : s - 1);
    }
    try {
      await apiFetch("/reactions", { method: "POST", body: { postId: post.id, emoji } });
    } catch (err: any) {
      setScore(prevScore);
      setUserVote(prevVote);
      toast({ title: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this post?")) return;
    setDeleting(true);
    try {
      await apiFetch("/feed", { method: "DELETE", body: { postId: post.id } });
      onUpdate?.();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
      setDeleting(false);
    }
  };

  const handleFlag = async () => {
    if (userFlagged) return;
    setFlagging(true);
    try {
      const res = await apiFetch("/report", { method: "POST", body: { postId: post.id } });
      setFlagCount(res.flagCount);
      setUserFlagged(true);
      if (res.removed) {
        toast({ title: "Post removed due to reports" });
        onUpdate?.();
      } else {
        toast({ title: "Post reported" });
      }
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setFlagging(false);
    }
  };

  const handleUnlockCredits = async () => {
    setUnlocking(true);
    try {
      await apiFetch("/feed", { method: "PATCH", body: { postId: post.id } });
      setIsUnlocked(true);
      toast({ title: "Post unlocked!" });
      onUpdate?.();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setUnlocking(false);
    }
  };

  const handleUnlockStripe = async () => {
    setUnlocking(true);
    try {
      const res = await apiFetch("/checkout", { method: "POST", body: { action: "post_unlock", postId: post.id } });
      if (res.url) window.location.href = res.url;
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
      setUnlocking(false);
    }
  };

  const timeAgo = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true });

  // Auto play/pause video based on active state.
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (active) v.play().catch(() => {});
    else { v.pause(); }
  }, [active, muted]);

  return (
    <div className="relative w-full h-[100dvh] snap-start snap-always bg-black flex items-center justify-center overflow-hidden">
      {/* Blurred preview for locked posts or logged-out teasers */}
      {mountMedia && (isLocked || isTeaser) && post.previewImageUrl && (
        <img src={previewMedia.src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-xl brightness-50" loading="lazy" decoding="async" onError={previewMedia.onError} />
      )}

      {mountMedia && !isLocked && !isTeaser && post.imageUrl && !mediaFailed ? (
        isVideo ? (
          <video
            ref={videoRef}
            src={active ? mainMedia.src : undefined}
            poster={post.previewImageUrl}
            className={`relative z-[1] w-full h-full object-contain transition-[filter] duration-300 ${isMatureBlurred ? "blur-2xl scale-110" : ""}`}
            muted={muted}
            playsInline
            preload={active ? "metadata" : "none"}
            loop
            onError={mainMedia.onError}
          />
        ) : (
          <img src={mainMedia.src} alt="" className={`relative z-[1] w-full h-full object-contain transition-[filter] duration-300 ${isMatureBlurred ? "blur-2xl scale-110" : ""}`} loading="lazy" decoding="async" onError={mainMedia.onError} />
        )
      ) : mountMedia && isTeaser && post.previewImageUrl ? (
        <img src={previewMedia.src} alt="" className="relative z-[1] w-full h-full object-contain blur-xl brightness-75 scale-105" loading="lazy" decoding="async" onError={previewMedia.onError} />
      ) : mountMedia && !isLocked && !isTeaser && mediaFailed && post.previewImageUrl ? (
        <img src={previewMedia.src} alt="" className="relative z-[1] w-full h-full object-contain opacity-80" loading="lazy" decoding="async" onError={previewMedia.onError} />
      ) : mountMedia && !isLocked && mediaFailed ? (
        <div className="relative z-10 px-8 max-w-full text-center">
          <p className="font-mono-share text-sm text-white/70">Media failed to load</p>
          {!!post.text && <p className="mt-3 font-mono-share text-xs text-white/55 whitespace-pre-wrap break-words line-clamp-5">{post.text}</p>}
        </div>
      ) : !isLocked ? (
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card to-background" />
      ) : null}

      {/* Mature reveal overlay */}
      {isMatureBlurred && !isLocked && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm">
          <div className="bg-black/70 rounded-full p-3 border border-amber-400/50">
            <EyeOff className="w-6 h-6 text-amber-300" />
          </div>
          <span className="font-orbitron text-xs tracking-widest text-amber-300">MATURE CONTENT</span>
          <button
            onClick={() => setMatureRevealed(true)}
            className="font-mono-share text-xs px-4 py-1.5 rounded-md border border-amber-400/50 text-amber-300 bg-black/40 hover:bg-amber-400/10 transition-colors"
          >
            REVEAL
          </button>
        </div>
      )}

      <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none" />

      {/* Sound toggle (videos) — global mute across reels; tap to hear audio */}
      {isVideo && mountMedia && !isLocked && !isTeaser && onToggleMuted && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
          className="absolute z-30 rounded-full bg-black/50 p-2.5 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/70"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 60px)", right: 12 }}
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
      )}

      {/* Owner-only LOCKED · price badge — creator always sees own post unblurred,
          so this confirms at a glance that the post IS locked for other viewers. */}
      {post.isOwner && ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0 || !!(post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0)) && (
        <div
          className="absolute z-20 flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm border border-amber-400/50 font-mono-share text-[10px] text-amber-300 tracking-wider"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)", left: 12 }}
          title="Locked for other viewers — they see a blurred preview and must unlock."
        >
          <Lock className="w-3 h-3" />
          <span>LOCKED ·</span>
          {(post.lockCost || 0) > 0 && <span>{post.lockCost}c</span>}
          {(post.lockPriceCents || 0) > 0 && <span>${((post.lockPriceCents || 0) / 100).toFixed(2)}</span>}
          {!!(post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0) && <span>{post.lockXrgeAmount} XRGE</span>}
        </div>
      )}


      {/* Viewer-side LOCKED · price chip — quick at-a-glance signal in addition
          to the centered unlock CTA below. Mirrors owner badge placement. */}
      {isLocked && (
        <div
          className="absolute z-20 flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm border border-amber-400/50 font-mono-share text-[10px] text-amber-300 tracking-wider shadow-[0_0_12px_rgba(251,191,36,0.25)]"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 12 }}
          title="Locked content — unlock to view"
        >
          <Lock className="w-3 h-3" />
          <span>LOCKED ·</span>
          {(post.lockCost || 0) > 0 && <span>{post.lockCost}c</span>}
          {(post.lockPriceCents || 0) > 0 && <span>${((post.lockPriceCents || 0) / 100).toFixed(2)}</span>}
          {!!(post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0) && <span>{post.lockXrgeAmount} XRGE</span>}
        </div>
      )}

      {/* Locked overlay */}
      {isLocked ? (
        <div className="relative z-10 flex flex-col items-center gap-4 px-8">
          <Lock className="w-12 h-12 text-amber-400/70" />
          <p className="font-orbitron text-sm text-white/80 tracking-wider text-center">LOCKED CONTENT</p>
          {post.previewText && (
            <p className="font-mono-share text-xs text-white/50 text-center max-w-xs italic">{post.previewText}</p>
          )}
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {(post.lockCost || 0) > 0 && (
              <Button
                onClick={handleUnlockCredits}
                disabled={unlocking}
                className="w-full font-mono-share text-xs bg-amber-500/20 border border-amber-400/40 text-amber-300 hover:bg-amber-500/30"
                variant="outline"
              >
                <Coins className="w-4 h-4 mr-2" />
                Unlock · {post.lockCost} credits
              </Button>
            )}
            {(post.lockPriceCents || 0) > 0 && (
              <Button
                onClick={handleUnlockStripe}
                disabled={unlocking}
                className="w-full font-mono-share text-xs bg-green-500/20 border border-green-400/40 text-green-300 hover:bg-green-500/30"
                variant="outline"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Unlock · ${((post.lockPriceCents || 0) / 100).toFixed(2)}
              </Button>
            )}
            {post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0 && (
              <Button
                onClick={() => setXrgeUnlockOpen(true)}
                disabled={unlocking}
                className="w-full font-mono-share text-xs bg-secondary/20 border border-secondary/40 text-secondary hover:bg-secondary/30"
                variant="outline"
              >
                <Zap className="w-4 h-4 mr-2" />
                Unlock · {post.lockXrgeAmount} XRGE ⚡
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Text-only posts */}
          {!post.imageUrl && post.text && (
            <div className="relative z-10 px-8 max-w-full">
              <p className="font-mono-share text-base text-foreground/90 whitespace-pre-wrap break-words text-center leading-relaxed">
                {post.text}
              </p>
            </div>
          )}
        </>
      )}

      {/* Right side actions */}
      <div className="absolute right-3 bottom-[30%] z-20 flex flex-col items-center gap-5">
        <button onClick={() => handleVote("👍")} className="flex flex-col items-center gap-0.5">
          <div className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
            userVote === "👍" ? "bg-primary/30 text-primary" : "bg-black/30 text-white/80"
          }`}>
            <ArrowBigUp className={`w-7 h-7 ${userVote === "👍" ? "fill-current" : ""}`} />
          </div>
        </button>

        <span className={`font-mono-share text-xs font-bold ${
          score > 0 ? "text-primary" : score < 0 ? "text-destructive" : "text-white/70"
        }`}>
          {score}
        </span>

        <button onClick={() => handleVote("👎")} className="flex flex-col items-center gap-0.5">
          <div className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
            userVote === "👎" ? "bg-destructive/30 text-destructive" : "bg-black/30 text-white/80"
          }`}>
            <ArrowBigDown className={`w-7 h-7 ${userVote === "👎" ? "fill-current" : ""}`} />
          </div>
        </button>

        {!isLocked && (
          <button onClick={() => setShowComments(!showComments)} className="flex flex-col items-center gap-0.5">
            <div className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
              showComments ? "bg-primary/30 text-primary" : "bg-black/30 text-white/80"
            }`}>
              <MessageCircle className="w-6 h-6" />
            </div>
            {commentCount > 0 && (
              <span className="font-mono-share text-[10px] text-white/70">{commentCount}</span>
            )}
          </button>
        )}

        <div className="flex flex-col items-center gap-0.5">
          <div className="p-2 rounded-full backdrop-blur-sm bg-black/30 text-white/50">
            <Eye className="w-5 h-5" />
          </div>
          <span className="font-mono-share text-[10px] text-white/50">{post.viewCount || 0}</span>
        </div>

        {user?.id !== post.userId && flagCount > 0 && (
          <div className="flex flex-col items-center gap-0.5 opacity-60">
            <Flag className="w-4 h-4 text-destructive/70" />
            <span className="font-mono-share text-[10px] text-destructive/80">{flagCount}</span>
          </div>
        )}

        {/* 3-dot menu — replaces inline delete/report */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More"
            className="p-2 rounded-full bg-black/30 text-white/70 hover:text-white backdrop-blur-sm transition-colors outline-none"
          >
            <MoreHorizontal className="w-5 h-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="left" className="z-[120] w-44 font-mono-share text-xs">
            <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
              <Link2 className="w-3.5 h-3.5 mr-2" /> Copy link
            </DropdownMenuItem>
            {user?.id !== post.userId && (
              <DropdownMenuItem
                onClick={handleFlag}
                disabled={flagging || userFlagged}
                className="cursor-pointer"
              >
                <Flag className={`w-3.5 h-3.5 mr-2 ${userFlagged ? "fill-current text-destructive" : ""}`} />
                {userFlagged ? "Reported" : "Report"}
              </DropdownMenuItem>
            )}
            {canToggleMature && (
              <DropdownMenuItem
                onClick={handleToggleMature}
                disabled={togglingMature}
                className="cursor-pointer"
              >
                <EyeOff className="w-3.5 h-3.5 mr-2" />
                {matureFlagged ? "Unmark as 18+" : "Mark as 18+"}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  disabled={deleting}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                  {deleting ? "Deleting…" : user?.id === post.userId ? "Delete" : "Delete (mod)"}
                </DropdownMenuItem>
              </>
            )}
            {isAdminOrMod && user?.id !== post.userId && (
              <DropdownMenuItem
                onClick={handleAdminBan}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <ShieldOff className="w-3.5 h-3.5 mr-2" />
                Ban user
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bottom info overlay */}
      <div className="absolute left-0 right-16 bottom-0 z-20 p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}>
        <button onClick={() => navigate(`/profile/${post.username}`)} className="flex items-center gap-2 mb-2">
          <Avatar className="w-9 h-9 border-2 border-white/30">
            {post.avatarUrl && <AvatarImage src={post.avatarUrl} alt={post.username} />}
            <AvatarFallback className="bg-primary/20 text-primary font-orbitron text-[10px]">
              {post.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="text-left">
            <span className="font-orbitron text-xs text-white font-semibold block drop-shadow-md">
              @{post.username}
            </span>
            <span className="font-mono-share text-[9px] text-white/60">{timeAgo}</span>
          </div>
        </button>

        {!isLocked && post.imageUrl && post.text && (
          <p className="font-mono-share text-sm text-white/90 whitespace-pre-wrap break-words line-clamp-3 drop-shadow-md">
            {post.text}
          </p>
        )}
      </div>

      {showComments && !isLocked && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 bg-card/95 backdrop-blur-md rounded-t-2xl max-h-[60dvh] flex flex-col"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-1 sticky top-0 bg-card/95 backdrop-blur-md z-10">
            <span className="font-orbitron text-xs text-foreground tracking-wider">COMMENTS</span>
            <button onClick={() => setShowComments(false)} className="font-mono-share text-[10px] text-muted-foreground">
              CLOSE
            </button>
          </div>
          <CommentThread postId={post.id} onCountChange={(count) => setCommentCount(count)} />
        </div>
      )}

      {post.lockXrgeAmount && (
        <XrgeUnlockDialog
          open={xrgeUnlockOpen}
          onClose={() => setXrgeUnlockOpen(false)}
          xrgeAmount={post.lockXrgeAmount}
          postId={post.id}
          onSuccess={() => { setIsUnlocked(true); onUpdate?.(); }}
        />
      )}
    </div>
  );
};

export default ReelCard;
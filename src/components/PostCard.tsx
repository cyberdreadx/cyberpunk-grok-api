import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowBigUp,
  ArrowBigDown,
  MessageCircle,
  Trash2,
  Flag,
  Lock,
  CreditCard,
  Coins,
  Zap,
  Eye,
  EyeOff,
  MoreHorizontal,
  Link2,
  ShieldOff,
  EyeOff as EyeOffIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CommentThread from "@/components/CommentThread";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import XrgeUnlockDialog from "@/components/XrgeUnlockDialog";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useMatureFilter } from "@/hooks/useMatureFilter";
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
  authorVerified?: boolean;
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
  reactionCount?: number;
  userReacted?: boolean;
  isMature?: boolean;
}

interface PostCardProps {
  post: FeedPost;
  onUpdate?: () => void;
}

const PostCard: React.FC<PostCardProps> = ({ post, onUpdate }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { matureFilter } = useMatureFilter();
  const [score, setScore] = useState(post.score ?? post.reactionCount ?? 0);
  const [userVote, setUserVote] = useState<string | null>(post.userVote ?? (post.userReacted ? "👍" : null));
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [deleting, setDeleting] = useState(false);
  const [flagCount, setFlagCount] = useState(post.flagCount ?? 0);
  const [userFlagged, setUserFlagged] = useState(post.userFlagged ?? false);
  const [flagging, setFlagging] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(post.unlocked ?? true);
  const [matureRevealed, setMatureRevealed] = useState(false);

  // Sync unlock state when props change (e.g. after fetchFeed refresh)
  React.useEffect(() => {
    if (post.unlocked !== undefined) setIsUnlocked(post.unlocked);
  }, [post.unlocked]);
  const [revealedText, setRevealedText] = useState<string | null>(null);
  const [revealedImage, setRevealedImage] = useState<string | null>(null);
  const [xrgeUnlockOpen, setXrgeUnlockOpen] = useState(false);

  const isLocked = !isUnlocked && !post.isOwner && ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0 || !!(post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0));
  const isMatureBlurred = !isLocked && matureFilter && !!post.isMature && !matureRevealed && !post.isOwner;

  const isAdminOrMod = !!user?.is_admin || !!user?.is_feed_mod;
  const canDelete = user?.id === post.userId || isAdminOrMod;

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

  const handleCopyLink = async () => {
    try {
      const url = `${window.location.origin}/feed?post=${post.id}`;
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  const handleAdminBan = async () => {
    if (!confirm(`Ban @${post.username}? This blocks the user from posting.`)) return;
    try {
      await apiFetch("/admin", { method: "POST", body: { action: "ban-user", userId: post.userId, reason: "Banned via feed moderation" } });
      toast({ title: "User banned" });
      onUpdate?.();
    } catch (err: any) {
      toast({ title: err.message || "Failed to ban", variant: "destructive" });
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

  return (
    <div className="bg-card/60 border border-border/40 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-2">
        <button onClick={() => navigate(`/profile/${post.username}`)} className="shrink-0">
          <Avatar className="w-8 h-8 border border-primary/20">
            {post.avatarUrl && <AvatarImage src={post.avatarUrl} alt={post.username} />}
            <AvatarFallback className="bg-primary/10 text-primary font-orbitron text-[10px]">
              {post.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </button>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => navigate(`/profile/${post.username}`)}
            className="font-orbitron text-xs text-foreground hover:text-primary transition-colors truncate block"
          >
            <span className="inline-flex items-center gap-1">
              @{post.username}
              {post.authorVerified && <VerifiedBadge size="xs" />}
            </span>
          </button>
          <span className="font-mono-share text-[9px] text-muted-foreground">{timeAgo}</span>
        </div>
        {isLocked && (
          <span className="flex items-center gap-1 text-amber-400 font-mono-share text-[9px]">
            <Lock className="w-3 h-3" /> LOCKED
          </span>
        )}
        {post.isMature && (
          <span className="flex items-center gap-1 text-amber-300/80 font-mono-share text-[9px] px-1.5 py-0.5 rounded border border-amber-300/30">
            18+
          </span>
        )}

        {/* 3-dot action menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Post actions"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 font-mono-share text-xs">
            <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
              <Link2 className="w-3.5 h-3.5 mr-2" />
              Copy link
            </DropdownMenuItem>
            {user?.id !== post.userId && (
              <DropdownMenuItem
                onClick={handleFlag}
                disabled={flagging || userFlagged}
                className="cursor-pointer"
              >
                <Flag className={`w-3.5 h-3.5 mr-2 ${userFlagged ? "fill-current text-destructive" : ""}`} />
                {userFlagged ? "Reported" : "Report post"}
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

      {/* Content */}
      {isLocked ? (
        <div className="relative overflow-hidden">
          {/* Blurred image preview */}
          {post.previewImageUrl && (
            <div className="relative w-full h-64 overflow-hidden">
              <img
                src={post.previewImageUrl}
                alt=""
                className="w-full h-full object-cover blur-xl scale-110 brightness-50"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-background/30" />
            </div>
          )}
          <div className={`${post.previewImageUrl ? "absolute inset-0 flex flex-col items-center justify-center" : "px-4 py-6"} space-y-3`}>
            {post.previewText && !post.previewImageUrl && (
              <p className="font-mono-share text-sm text-muted-foreground/60 italic">{post.previewText}</p>
            )}
            <div className="flex flex-col items-center gap-3 py-4">
              <Lock className="w-8 h-8 text-amber-400/60" />
              <p className="font-mono-share text-xs text-muted-foreground text-center">This content is locked by the creator</p>
              {post.previewText && post.previewImageUrl && (
                <p className="font-mono-share text-[10px] text-white/50 italic text-center max-w-xs">{post.previewText}</p>
              )}
              <div className="flex gap-2 flex-wrap justify-center">
                {(post.lockCost || 0) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleUnlockCredits}
                    disabled={unlocking}
                    className="font-mono-share text-[10px] border-amber-400/30 text-amber-400 hover:bg-amber-400/10"
                  >
                    <Coins className="w-3 h-3 mr-1" />
                    Unlock · {post.lockCost} credits
                  </Button>
                )}
                {(post.lockPriceCents || 0) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleUnlockStripe}
                    disabled={unlocking}
                    className="font-mono-share text-[10px] border-green-400/30 text-green-400 hover:bg-green-400/10"
                  >
                    <CreditCard className="w-3 h-3 mr-1" />
                    Unlock · ${((post.lockPriceCents || 0) / 100).toFixed(2)}
                  </Button>
                )}
                {post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setXrgeUnlockOpen(true)}
                    disabled={unlocking}
                    className="font-mono-share text-[10px] border-secondary/30 text-secondary hover:bg-secondary/10"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Unlock · {post.lockXrgeAmount} XRGE
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {(revealedText || post.text) && (
            <p className="px-4 pb-2 font-mono-share text-sm text-foreground/90 whitespace-pre-wrap break-words">{revealedText || post.text}</p>
          )}
          {(revealedImage || post.imageUrl) && (
            <div className="relative">
              <img
                src={revealedImage || post.imageUrl!}
                alt=""
                className={`w-full max-h-[500px] object-cover transition-[filter] duration-300 ${
                  isMatureBlurred ? "blur-2xl scale-105" : ""
                }`}
                loading="lazy"
              />
              {isMatureBlurred && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/40 backdrop-blur-sm">
                  <div className="bg-black/70 rounded-full p-2 border border-amber-400/40">
                    <EyeOff className="w-5 h-5 text-amber-300" />
                  </div>
                  <span className="font-mono-share text-[10px] tracking-widest text-amber-300/90">MATURE CONTENT</span>
                  <button
                    onClick={() => setMatureRevealed(true)}
                    className="font-mono-share text-[10px] px-3 py-1 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 transition-colors"
                  >
                    REVEAL
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Actions */}
      {!isLocked && (
        <div className="flex items-center gap-1 px-4 py-2.5 border-t border-border/20">
          <div className="flex items-center gap-0.5 bg-muted/30 rounded-full px-1 py-0.5">
            <button
              onClick={() => handleVote("👍")}
              className={`p-1 rounded-full transition-colors ${
                userVote === "👍" ? "text-primary bg-primary/15" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
              }`}
              title="Upvote"
            >
              <ArrowBigUp className={`w-5 h-5 ${userVote === "👍" ? "fill-current" : ""}`} />
            </button>
            <span className={`font-mono-share text-xs min-w-[1.5rem] text-center font-semibold ${
              score > 0 ? "text-primary" : score < 0 ? "text-destructive" : "text-muted-foreground"
            }`}>
              {score}
            </span>
            <button
              onClick={() => handleVote("👎")}
              className={`p-1 rounded-full transition-colors ${
                userVote === "👎" ? "text-destructive bg-destructive/15" : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              }`}
              title="Downvote"
            >
              <ArrowBigDown className={`w-5 h-5 ${userVote === "👎" ? "fill-current" : ""}`} />
            </button>
          </div>
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1.5 font-mono-share text-[10px] text-muted-foreground hover:text-primary transition-colors ml-3"
          >
            <MessageCircle className="w-4 h-4" />
            {commentCount > 0 && commentCount}
          </button>
          <span className="flex items-center gap-1 font-mono-share text-[10px] text-muted-foreground/50 ml-2">
            <Eye className="w-3.5 h-3.5" />
            {post.viewCount || 0}
          </span>

          {flagCount > 0 && (
            <span className="flex items-center gap-1 font-mono-share text-[10px] text-muted-foreground/40 ml-auto" title="Reports">
              <Flag className="w-3.5 h-3.5" />
              {flagCount}
            </span>
          )}
        </div>
      )}

      {showComments && !isLocked && (
        <CommentThread postId={post.id} onCountChange={(count) => setCommentCount(count)} />
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

export default PostCard;

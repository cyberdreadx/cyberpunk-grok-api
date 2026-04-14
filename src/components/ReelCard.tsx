import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Trash2, Flag, Lock, Coins, CreditCard, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CommentThread from "@/components/CommentThread";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import XrgeUnlockDialog from "@/components/XrgeUnlockDialog";

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

interface ReelCardProps {
  post: FeedPost;
  onUpdate?: () => void;
}

const ReelCard: React.FC<ReelCardProps> = ({ post, onUpdate }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
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
  const [xrgeUnlockOpen, setXrgeUnlockOpen] = useState(false);

  const isLocked = !isUnlocked && !post.isOwner && ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0 || !!(post.lockXrgeAmount && parseFloat(post.lockXrgeAmount) > 0));

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
  const isVideo = post.imageUrl ? /\.(mp4|webm|mov)(\?|$)/i.test(post.imageUrl) || post.imageUrl.includes("video") : false;

  return (
    <div className="relative w-full h-[100dvh] snap-start snap-always bg-black flex items-center justify-center overflow-hidden">
      {/* Background / media */}
      {!isLocked && post.imageUrl && (
        isVideo ? (
          <video src={post.imageUrl} className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40" muted playsInline autoPlay loop />
        ) : (
          <img src={post.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40" />
        )
      )}

      {/* Blurred preview for locked posts with images */}
      {isLocked && post.previewImageUrl && (
        <>
          <img src={post.previewImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-30" />
          <img src={post.previewImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover blur-xl brightness-50" />
        </>
      )}

      {!isLocked && post.imageUrl ? (
        isVideo ? (
          <video src={post.imageUrl} className="relative z-[1] w-full h-full object-contain" muted playsInline autoPlay loop />
        ) : (
          <img src={post.imageUrl} alt="" className="relative z-[1] w-full h-full object-contain" loading="lazy" />
        )
      ) : !isLocked ? (
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card to-background" />
      ) : null}

      <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none" />

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

        {user?.id !== post.userId && (
          <button onClick={handleFlag} disabled={flagging || userFlagged} className="flex flex-col items-center gap-0.5">
            <div className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
              userFlagged ? "bg-destructive/30 text-destructive" : "bg-black/30 text-white/60 hover:text-destructive"
            }`}>
              <Flag className={`w-5 h-5 ${userFlagged ? "fill-current" : ""}`} />
            </div>
            {flagCount > 0 && (
              <span className="font-mono-share text-[10px] text-destructive/80">{flagCount}</span>
            )}
          </button>
        )}

        {(user?.id === post.userId || user?.is_admin || user?.is_feed_mod) && (
          <button onClick={handleDelete} disabled={deleting} className="flex flex-col items-center gap-0.5">
            <div className="p-2 rounded-full bg-black/30 text-white/60 hover:text-destructive backdrop-blur-sm transition-colors">
              <Trash2 className="w-5 h-5" />
            </div>
          </button>
        )}
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
          className="absolute inset-x-0 bottom-0 z-30 bg-card/95 backdrop-blur-md rounded-t-2xl max-h-[60dvh] overflow-y-auto"
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
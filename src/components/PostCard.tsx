import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Trash2, Flag, Lock, CreditCard, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CommentThread from "@/components/CommentThread";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

interface FeedPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  imageUrl: string | null;
  previewText?: string;
  createdAt: string;
  score: number;
  userVote: string | null;
  commentCount: number;
  flagCount?: number;
  userFlagged?: boolean;
  lockCost?: number;
  lockPriceCents?: number;
  unlocked?: boolean;
  isOwner?: boolean;
  reactionCount?: number;
  userReacted?: boolean;
}

interface PostCardProps {
  post: FeedPost;
  onUpdate?: () => void;
}

const PostCard: React.FC<PostCardProps> = ({ post, onUpdate }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
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
  const [revealedText, setRevealedText] = useState<string | null>(null);
  const [revealedImage, setRevealedImage] = useState<string | null>(null);

  const isLocked = !isUnlocked && !post.isOwner && ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0);

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
            @{post.username}
          </button>
          <span className="font-mono-share text-[9px] text-muted-foreground">{timeAgo}</span>
        </div>
        {isLocked && (
          <span className="flex items-center gap-1 text-amber-400 font-mono-share text-[9px]">
            <Lock className="w-3 h-3" /> LOCKED
          </span>
        )}
        {(user?.id === post.userId || user?.is_admin || user?.is_feed_mod) && (
          <button onClick={handleDelete} disabled={deleting} className="text-muted-foreground/40 hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      {isLocked ? (
        <div className="px-4 py-6 space-y-3">
          {post.previewText && (
            <p className="font-mono-share text-sm text-muted-foreground/60 italic">{post.previewText}</p>
          )}
          <div className="flex flex-col items-center gap-3 py-4">
            <Lock className="w-8 h-8 text-amber-400/60" />
            <p className="font-mono-share text-xs text-muted-foreground text-center">This content is locked by the creator</p>
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
            </div>
          </div>
        </div>
      ) : (
        <>
          {(revealedText || post.text) && (
            <p className="px-4 pb-2 font-mono-share text-sm text-foreground/90 whitespace-pre-wrap break-words">{revealedText || post.text}</p>
          )}
          {(revealedImage || post.imageUrl) && (
            <img src={revealedImage || post.imageUrl!} alt="" className="w-full max-h-[500px] object-cover" loading="lazy" />
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

          {user?.id !== post.userId && (
            <button
              onClick={handleFlag}
              disabled={flagging || userFlagged}
              className={`flex items-center gap-1 font-mono-share text-[10px] ml-auto transition-colors ${
                userFlagged ? "text-destructive" : "text-muted-foreground/40 hover:text-destructive"
              }`}
              title={userFlagged ? "You reported this post" : "Report post"}
            >
              <Flag className={`w-3.5 h-3.5 ${userFlagged ? "fill-current" : ""}`} />
              {flagCount > 0 && <span>{flagCount}</span>}
            </button>
          )}
        </div>
      )}

      {showComments && !isLocked && (
        <CommentThread postId={post.id} onCountChange={(count) => setCommentCount(count)} />
      )}
    </div>
  );
};

export default PostCard;
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Trash2, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CommentThread from "@/components/CommentThread";
import { formatDistanceToNow } from "date-fns";

interface FeedPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  imageUrl: string | null;
  createdAt: string;
  score: number;
  userVote: string | null;
  commentCount: number;
  flagCount?: number;
  userFlagged?: boolean;
  // Legacy compat
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

  const handleVote = async (emoji: "👍" | "👎") => {
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
      await apiFetch("/reactions", {
        method: "POST",
        body: { postId: post.id, emoji },
      });
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
      const res = await apiFetch("/report", {
        method: "POST",
        body: { postId: post.id },
      });
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
        {(user?.id === post.userId || user?.is_admin || user?.is_feed_mod) && (
          <button onClick={handleDelete} disabled={deleting} className="text-muted-foreground/40 hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      {post.text && (
        <p className="px-4 pb-2 font-mono-share text-sm text-foreground/90 whitespace-pre-wrap break-words">{post.text}</p>
      )}
      {post.imageUrl && (
        <img src={post.imageUrl} alt="" className="w-full max-h-[500px] object-cover" loading="lazy" />
      )}

      {/* Actions — upvote / score / downvote / comments / flag */}
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

        {/* Flag / Report */}
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

      {/* Comments */}
      {showComments && (
        <CommentThread
          postId={post.id}
          onCountChange={(count) => setCommentCount(count)}
        />
      )}
    </div>
  );
};

export default PostCard;

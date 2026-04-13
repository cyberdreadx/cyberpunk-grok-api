import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Heart, MessageCircle, Trash2 } from "lucide-react";
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
  reactionCount: number;
  commentCount: number;
  userReacted: boolean;
}

interface PostCardProps {
  post: FeedPost;
  onUpdate?: () => void;
}

const PostCard: React.FC<PostCardProps> = ({ post, onUpdate }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reacted, setReacted] = useState(post.userReacted);
  const [reactionCount, setReactionCount] = useState(post.reactionCount);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [deleting, setDeleting] = useState(false);

  const handleReact = async () => {
    try {
      const data = await apiFetch<{ action: string }>("/reactions", {
        method: "POST",
        body: { postId: post.id, emoji: "❤️" },
      });
      if (data.action === "added") {
        setReacted(true);
        setReactionCount((c) => c + 1);
      } else {
        setReacted(false);
        setReactionCount((c) => Math.max(0, c - 1));
      }
    } catch (err: any) {
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

  const timeAgo = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true });

  return (
    <div className="bg-card/60 border border-border/40 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-2">
        <button onClick={() => navigate(`/profile/${post.username}`)} className="shrink-0">
          <Avatar className="w-8 h-8 border border-primary/20">
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
        {(user?.id === post.userId || user?.is_admin) && (
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

      {/* Actions */}
      <div className="flex items-center gap-4 px-4 py-3 border-t border-border/20">
        <button
          onClick={handleReact}
          className={`flex items-center gap-1.5 font-mono-share text-[10px] transition-colors ${
            reacted ? "text-destructive" : "text-muted-foreground hover:text-destructive"
          }`}
        >
          <Heart className={`w-4 h-4 ${reacted ? "fill-current" : ""}`} />
          {reactionCount > 0 && reactionCount}
        </button>
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 font-mono-share text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          {commentCount > 0 && commentCount}
        </button>
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

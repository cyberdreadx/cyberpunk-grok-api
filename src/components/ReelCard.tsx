import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Trash2 } from "lucide-react";
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

  const timeAgo = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true });

  const isVideo = post.imageUrl ? /\.(mp4|webm|mov)(\?|$)/i.test(post.imageUrl) || post.imageUrl.includes("video") : false;

  return (
    <div className="relative w-full h-[100dvh] snap-start snap-always bg-black flex items-center justify-center overflow-hidden">
      {/* Blurred background fill for letterboxing */}
      {post.imageUrl && (
        isVideo ? (
          <video src={post.imageUrl} className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40" muted playsInline autoPlay loop />
        ) : (
          <img src={post.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40" />
        )
      )}

      {/* Main media — object-contain to show full dimensions */}
      {post.imageUrl ? (
        isVideo ? (
          <video
            src={post.imageUrl}
            className="relative z-[1] w-full h-full object-contain"
            muted playsInline autoPlay loop
          />
        ) : (
          <img
            src={post.imageUrl}
            alt=""
            className="relative z-[1] w-full h-full object-contain"
            loading="lazy"
          />
        )
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card to-background" />
      )}

      {/* Dark overlay for readability on overlaid text */}
      <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none" />

      {/* Text-only posts: centered text */}
      {!post.imageUrl && post.text && (
        <div className="relative z-10 px-8 max-w-full">
          <p className="font-mono-share text-base text-foreground/90 whitespace-pre-wrap break-words text-center leading-relaxed">
            {post.text}
          </p>
        </div>
      )}

      {/* Right side actions (TikTok style) */}
      <div className="absolute right-3 bottom-[30%] z-20 flex flex-col items-center gap-5">
        {/* Upvote */}
        <button onClick={() => handleVote("👍")} className="flex flex-col items-center gap-0.5">
          <div className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
            userVote === "👍" ? "bg-primary/30 text-primary" : "bg-black/30 text-white/80"
          }`}>
            <ArrowBigUp className={`w-7 h-7 ${userVote === "👍" ? "fill-current" : ""}`} />
          </div>
        </button>

        {/* Score */}
        <span className={`font-mono-share text-xs font-bold ${
          score > 0 ? "text-primary" : score < 0 ? "text-destructive" : "text-white/70"
        }`}>
          {score}
        </span>

        {/* Downvote */}
        <button onClick={() => handleVote("👎")} className="flex flex-col items-center gap-0.5">
          <div className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
            userVote === "👎" ? "bg-destructive/30 text-destructive" : "bg-black/30 text-white/80"
          }`}>
            <ArrowBigDown className={`w-7 h-7 ${userVote === "👎" ? "fill-current" : ""}`} />
          </div>
        </button>

        {/* Comments */}
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

        {/* Delete */}
        {(user?.id === post.userId || user?.is_admin) && (
          <button onClick={handleDelete} disabled={deleting} className="flex flex-col items-center gap-0.5">
            <div className="p-2 rounded-full bg-black/30 text-white/60 hover:text-destructive backdrop-blur-sm transition-colors">
              <Trash2 className="w-5 h-5" />
            </div>
          </button>
        )}
      </div>

      {/* Bottom info overlay */}
      <div className="absolute left-0 right-16 bottom-0 z-20 p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}>
        {/* User info */}
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

        {/* Caption (for image posts) */}
        {post.imageUrl && post.text && (
          <p className="font-mono-share text-sm text-white/90 whitespace-pre-wrap break-words line-clamp-3 drop-shadow-md">
            {post.text}
          </p>
        )}
      </div>

      {/* Comments overlay */}
      {showComments && (
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
    </div>
  );
};

export default ReelCard;

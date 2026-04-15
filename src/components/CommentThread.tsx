import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Trash2, CornerDownRight, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface Comment {
  id: string;
  postId: string;
  userId: string;
  parentId: string | null;
  text: string;
  createdAt: string;
  username: string;
  avatarUrl: string | null;
}

interface CommentThreadProps {
  postId: string;
  onCountChange?: (count: number) => void;
}

const CommentThread: React.FC<CommentThreadProps> = ({ postId, onCountChange }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchComments = useCallback(async () => {
    try {
      const data = await apiFetch<Comment[]>(`/comments?postId=${postId}`);
      setComments(data);
      onCountChange?.(data.length);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [postId, onCountChange]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const handleSubmit = async () => {
    if (!newText.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch("/comments", {
        method: "POST",
        body: { postId, text: newText.trim(), parentId: replyTo },
      });
      setNewText("");
      setReplyTo(null);
      fetchComments();
      toast.success("Comment posted");
    } catch (err: any) {
      toast.error(err.message || "Failed to post comment");
    }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await apiFetch("/comments", { method: "DELETE", body: { commentId } });
      fetchComments();
      toast.success("Comment deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete comment");
    }
  };

  // Build tree
  const topLevel = comments.filter((c) => !c.parentId);
  const replies = (parentId: string) => comments.filter((c) => c.parentId === parentId);

  const renderComment = (comment: Comment, depth = 0) => (
    <div key={comment.id} className={`${depth > 0 ? "ml-6 border-l border-border/20 pl-3" : ""}`}>
      <div className="flex items-start gap-2 py-2">
        <button onClick={() => navigate(`/profile/${comment.username}`)} className="shrink-0 mt-0.5">
          <Avatar className="w-5 h-5 border border-primary/10">
            {comment.avatarUrl && <AvatarImage src={comment.avatarUrl} alt={comment.username} />}
            <AvatarFallback className="bg-primary/5 text-primary font-orbitron text-[7px]">
              {comment.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/profile/${comment.username}`)}
              className="font-orbitron text-[9px] text-foreground hover:text-primary transition-colors"
            >
              @{comment.username}
            </button>
            <span className="font-mono-share text-[8px] text-muted-foreground">
              {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
            </span>
          </div>
          <p className="font-mono-share text-xs text-foreground/80 break-words">{comment.text}</p>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => setReplyTo(comment.id)}
              className="font-mono-share text-[8px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              <CornerDownRight className="w-2.5 h-2.5" /> REPLY
            </button>
            {user?.id === comment.userId && (
              <button
                onClick={() => handleDelete(comment.id)}
                className="font-mono-share text-[8px] text-muted-foreground/40 hover:text-destructive transition-colors"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
      </div>
      {replies(comment.id).map((r) => renderComment(r, depth + 1))}
    </div>
  );

  return (
    <div className="border-t border-border/20 flex flex-col">
      <div className="px-4 py-3 space-y-2 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {topLevel.map((c) => renderComment(c))}
            {comments.length === 0 && (
              <p className="font-mono-share text-[10px] text-muted-foreground text-center py-2">No comments yet</p>
            )}
          </>
        )}
      </div>

      {/* Compose — sticky at bottom */}
      <div className="sticky bottom-0 bg-card/95 backdrop-blur-md border-t border-border/20 px-4 py-2 z-10">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            {replyTo && (
              <div className="absolute -top-5 left-0 font-mono-share text-[8px] text-primary flex items-center gap-1">
                <CornerDownRight className="w-2 h-2" /> Replying...
                <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground ml-1">✕</button>
              </div>
            )}
            <Input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Add a comment..."
              maxLength={1000}
              className="h-8 text-xs font-mono-share bg-input/50 border-border/30"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit()}
            />
          </div>
          <Button size="sm" variant="ghost" onClick={handleSubmit} disabled={submitting || !newText.trim()} className="h-8 w-8 p-0 shrink-0">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CommentThread;

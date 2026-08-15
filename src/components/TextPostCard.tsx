import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  Trash2,
  Flag,
  Lock,
  MoreHorizontal,
  ShieldAlert,
  Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CommentThread from "@/components/CommentThread";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useMatureFilter } from "@/hooks/useMatureFilter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A text-only feed post. Same row shape the grid gets, minus the media. */
export interface TextPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  authorVerified?: boolean;
  text: string;
  previewText?: string;
  createdAt: string;
  score: number;
  userVote?: string | null;
  commentCount: number;
  viewCount?: number;
  isMature?: boolean;
  isOwner?: boolean;
  lockCost?: number;
  lockPriceCents?: number;
  lockXrgeAmount?: string;
  unlocked?: boolean;
}

interface Props {
  post: TextPost;
  onUpdate?: () => void;
}

/** Compact relative time, X-style: 45s / 12m / 3h / 6d / Apr 18. */
const timeAgo = (iso: string) => {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// Long posts collapse rather than pushing everything below them off-screen.
const CLAMP_CHARS = 420;

const TextPostCard: React.FC<Props> = ({ post, onUpdate }) => {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { matureFilter } = useMatureFilter();

  const [score, setScore] = useState(post.score ?? 0);
  const [userVote, setUserVote] = useState<string | null>(post.userVote ?? null);
  const [commentCount, setCommentCount] = useState(post.commentCount ?? 0);
  const [showComments, setShowComments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const xrge = post.lockXrgeAmount ? parseFloat(post.lockXrgeAmount) : 0;
  const isOwner = post.isOwner ?? (!!user?.id && user.id === post.userId);
  const isLocked =
    !post.unlocked && !isOwner &&
    ((post.lockCost || 0) > 0 || (post.lockPriceCents || 0) > 0 || xrge > 0);
  // The server already blanks `text` on locked posts and sends a short teaser
  // instead — there is nothing to un-blur client-side.
  const body = isLocked ? (post.previewText || "") : post.text;
  const isMatureHidden = !!post.isMature && matureFilter && !isLocked && !isOwner && !revealed;

  const isAdminOrMod = !!user?.is_admin || !!user?.is_feed_mod;
  const canDelete = user?.id === post.userId || isAdminOrMod;
  const initials = (post.username || "?").slice(0, 2).toUpperCase();
  const isLong = body.length > CLAMP_CHARS;
  const shown = isLong && !expanded ? body.slice(0, CLAMP_CHARS).trimEnd() + "…" : body;

  const requireAuth = () => {
    if (!isAuthenticated) {
      toast({ title: "Sign in to interact", description: "Create a free account to join the conversation." });
      navigate("/create?signup=1");
      return false;
    }
    return true;
  };

  const handleVote = async () => {
    if (isLocked || !requireAuth()) return;
    const prevScore = score;
    const prevVote = userVote;
    // Single-tap like, X-style: tapping again takes it back.
    const liked = userVote === "👍";
    setUserVote(liked ? null : "👍");
    setScore((s) => (liked ? s - 1 : s + 1));
    try {
      await apiFetch("/reactions", { method: "POST", body: { postId: post.id, emoji: "👍" } });
      window.dispatchEvent(new Event("karma-changed"));
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
    try {
      const res = await apiFetch<{ removed?: boolean }>("/report", { method: "POST", body: { postId: post.id } });
      toast({ title: res.removed ? "Post removed due to reports" : "Post reported" });
      if (res.removed) onUpdate?.();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    }
  };

  const handleShare = async () => {
    // publicUrl (gltchrunner.com), NOT the app origin — *.gltch.app is
    // domain-blocked on Reddit/X; nginx 302s /feed back to the app.
    const url = `${BRAND.publicUrl}/feed?post=${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ text: post.text?.slice(0, 200), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      /* user dismissed the share sheet — not an error worth a toast */
    }
  };

  if (deleting) return null;

  const liked = userVote === "👍";

  return (
    <article className="relative flex gap-3 px-4 py-3.5 border-b border-border/30 hover:bg-card/30 transition-colors">
      {/* Avatar rail — the vertical line is the Threads cue that replies hang below */}
      <div className="flex flex-col items-center shrink-0">
        <button
          onClick={() => navigate(`/profile/${post.username}`)}
          className="rounded-full ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label={`@${post.username}'s profile`}
        >
          <Avatar className="w-10 h-10 border border-border/40">
            {post.avatarUrl && <AvatarImage src={post.avatarUrl} alt={post.username} />}
            <AvatarFallback className="text-[10px] font-mono-share bg-muted">{initials}</AvatarFallback>
          </Avatar>
        </button>
        {showComments && commentCount > 0 && (
          <div className="w-px flex-1 mt-2 bg-gradient-to-b from-border/60 to-transparent" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Header row */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate(`/profile/${post.username}`)}
            className="font-mono-share text-[13px] text-foreground hover:text-primary transition-colors truncate max-w-[45%]"
          >
            @{post.username}
          </button>
          {post.authorVerified && <VerifiedBadge size="xs" />}
          <span className="text-muted-foreground/50 text-xs">·</span>
          <span className="font-mono-share text-[11px] text-muted-foreground shrink-0">
            {timeAgo(post.createdAt)}
          </span>
          {post.isMature && (
            <span className="ml-1 px-1 rounded-sm font-mono-share text-[8px] tracking-wider text-amber-300 border border-amber-400/40 bg-amber-400/10 shrink-0">
              18+
            </span>
          )}

          <div className="ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1 -mr-1 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
                  aria-label="Post options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={handleShare} className="font-mono-share text-xs">
                  <Share className="w-3.5 h-3.5 mr-2" /> Share
                </DropdownMenuItem>
                {!isOwner && (
                  <DropdownMenuItem onClick={handleFlag} className="font-mono-share text-xs">
                    <Flag className="w-3.5 h-3.5 mr-2" /> Report
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleDelete}
                      className="font-mono-share text-xs text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Body — the reason this lane exists: real type, not a 11px tile caption */}
        {isLocked ? (
          <div className="mt-1.5 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
            <p className="font-mono-share text-[13px] text-muted-foreground italic leading-relaxed break-words">
              {body || "Locked post"}
            </p>
            <div className="mt-2 flex items-center gap-1.5 font-mono-share text-[10px] tracking-wider text-amber-300">
              <Lock className="w-3 h-3" />
              UNLOCK ·
              {(post.lockCost || 0) > 0 && <span>{post.lockCost} CR</span>}
              {(post.lockPriceCents || 0) > 0 && <span>${((post.lockPriceCents || 0) / 100).toFixed(2)}</span>}
              {xrge > 0 && <span>{post.lockXrgeAmount} XRGE</span>}
            </div>
          </div>
        ) : isMatureHidden ? (
          <button
            onClick={() => setRevealed(true)}
            className="mt-1.5 w-full rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 flex items-center justify-center gap-2 hover:bg-amber-400/10 transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-300" />
            <span className="font-mono-share text-[11px] tracking-wider text-amber-200">
              18+ — TAP TO REVEAL
            </span>
          </button>
        ) : (
          <p className="mt-1 font-mono-share text-[15px] leading-relaxed text-foreground/95 whitespace-pre-wrap break-words">
            {shown}
            {isLong && !expanded && (
              <button
                onClick={() => setExpanded(true)}
                className="ml-1 text-primary hover:underline text-[13px]"
              >
                more
              </button>
            )}
          </p>
        )}

        {/* Actions */}
        {!isLocked && (
          <div className="mt-2.5 flex items-center gap-1 -ml-1.5">
            <button
              onClick={handleVote}
              className={`group flex items-center gap-1.5 px-1.5 py-1 rounded-full transition-colors ${
                liked ? "text-rose-400" : "text-muted-foreground hover:text-rose-400"
              }`}
              aria-pressed={liked}
              aria-label="Like"
            >
              <Heart className={`w-[18px] h-[18px] transition-transform group-active:scale-90 ${liked ? "fill-current" : ""}`} />
              {score !== 0 && <span className="font-mono-share text-[11px]">{score}</span>}
            </button>

            <button
              onClick={() => { if (requireAuth()) setShowComments((v) => !v); }}
              className={`flex items-center gap-1.5 px-1.5 py-1 rounded-full transition-colors ${
                showComments ? "text-primary" : "text-muted-foreground hover:text-primary"
              }`}
              aria-expanded={showComments}
              aria-label="Replies"
            >
              <MessageCircle className="w-[18px] h-[18px]" />
              {commentCount > 0 && <span className="font-mono-share text-[11px]">{commentCount}</span>}
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded-full text-muted-foreground hover:text-secondary transition-colors"
              aria-label="Share"
            >
              <Repeat2 className="w-[18px] h-[18px]" />
            </button>

            {(post.viewCount ?? 0) > 0 && (
              <span className="ml-auto flex items-center gap-1 font-mono-share text-[10px] text-muted-foreground/50">
                <Eye className="w-3.5 h-3.5" />
                {post.viewCount}
              </span>
            )}
          </div>
        )}

        {showComments && !isLocked && (
          <div className="mt-1">
            <CommentThread postId={post.id} onCountChange={setCommentCount} />
          </div>
        )}
      </div>
    </article>
  );
};

export default TextPostCard;

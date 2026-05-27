import React, { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  ArrowBigUp,
  ArrowBigDown,
  Copy,
  Check,
  Trash2,
  Sparkles,
  Flame,
  Trophy,
  Clock,
  Plus,
  X,
  Wand2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import CyberLayout from "@/components/CyberLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import VerifiedBadge from "@/components/VerifiedBadge";

interface PromptPost {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  authorVerified?: boolean;
  title: string;
  prompt: string;
  negativePrompt: string;
  mode: string;
  tags: string[];
  exampleImageUrl: string | null;
  createdAt: string;
  score: number;
  userVote: string | null;
  isOwner?: boolean;
}

type SortMode = "hot" | "top" | "new";

const MODE_OPTIONS = [
  { value: "text-to-image", label: "Text → Image" },
  { value: "text-to-video", label: "Text → Video" },
  { value: "image-to-video", label: "Image → Video" },
  { value: "edit-image", label: "Edit Image" },
  { value: "comfy", label: "Comfy / LoRA" },
];

const DRAFT_KEY = "prompt-share-draft";

function modeLabel(mode: string) {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label || mode;
}

function PromptCard({
  post,
  onDelete,
  onVoteChange,
  requireAuth,
}: {
  post: PromptPost;
  onDelete: (id: string) => void;
  onVoteChange: (id: string, score: number, userVote: string | null) => void;
  requireAuth: () => boolean;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [score, setScore] = useState(post.score);
  const [userVote, setUserVote] = useState<string | null>(post.userVote);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setScore(post.score);
    setUserVote(post.userVote);
  }, [post.score, post.userVote]);

  const handleVote = async (emoji: "👍" | "👎") => {
    if (!requireAuth()) return;
    const prevScore = score;
    const prevVote = userVote;
    let nextScore = score;
    let nextVote: string | null = emoji;

    if (userVote === emoji) {
      nextVote = null;
      nextScore = emoji === "👍" ? score - 1 : score + 1;
    } else if (userVote) {
      nextScore = emoji === "👍" ? score + 2 : score - 2;
    } else {
      nextScore = emoji === "👍" ? score + 1 : score - 1;
    }

    setUserVote(nextVote);
    setScore(nextScore);

    try {
      await apiFetch("/prompt-votes", { method: "POST", body: { postId: post.id, emoji } });
      onVoteChange(post.id, nextScore, nextVote);
      window.dispatchEvent(new Event("karma-changed"));
    } catch (err: any) {
      setScore(prevScore);
      setUserVote(prevVote);
      toast({ title: err.message || "Vote failed", variant: "destructive" });
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(post.prompt);
      setCopied(true);
      toast({ title: "Prompt copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleTry = () => {
    const q = encodeURIComponent(post.prompt.slice(0, 800));
    navigate(`/create?prompt=${q}`);
  };

  const handleDelete = async () => {
    if (!confirm("Remove this prompt from the board?")) return;
    setDeleting(true);
    try {
      await apiFetch("/prompts", { method: "DELETE", body: { postId: post.id } });
      onDelete(post.id);
      toast({ title: "Prompt removed" });
    } catch (err: any) {
      toast({ title: err.message || "Delete failed", variant: "destructive" });
      setDeleting(false);
    }
  };

  const promptPreview = expanded ? post.prompt : post.prompt.slice(0, 280);
  const showExpand = post.prompt.length > 280;

  return (
    <Card className="p-4 border-border/60 bg-card/80 space-y-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => navigate(`/profile/${post.username}`)}
          className="shrink-0"
        >
          <Avatar className="w-9 h-9 border border-primary/20">
            <AvatarImage src={post.avatarUrl || undefined} />
            <AvatarFallback className="text-xs">{post.username?.[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => navigate(`/profile/${post.username}`)}
              className="font-orbitron text-xs text-foreground hover:text-primary transition-colors"
            >
              @{post.username}
            </button>
            {post.authorVerified && <VerifiedBadge className="w-3.5 h-3.5" />}
            <span className="text-muted-foreground/50 text-[10px]">·</span>
            <span className="text-[10px] text-muted-foreground font-mono-share">
              {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
            </span>
          </div>
          {post.title && (
            <h3 className="font-orbitron text-sm text-primary mt-1 tracking-wide">{post.title}</h3>
          )}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-secondary/30 bg-secondary/10 text-secondary font-mono-share">
              {modeLabel(post.mode)}
            </span>
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground font-mono-share"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
        {post.isOwner && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {post.exampleImageUrl && (
        <div className="rounded-md overflow-hidden border border-border/40 bg-black/20">
          <img
            src={post.exampleImageUrl}
            alt={post.title || "Example result"}
            className="w-full max-h-64 object-contain"
            loading="lazy"
          />
        </div>
      )}

      <div className="rounded-md border border-border/30 bg-background/40 p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="font-orbitron text-[9px] text-muted-foreground tracking-widest">PROMPT</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={handleCopy}>
              {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
              COPY
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-primary" onClick={handleTry}>
              <Wand2 className="w-3 h-3 mr-1" />
              TRY
            </Button>
          </div>
        </div>
        <p className="font-rajdhani text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
          {promptPreview}
          {!expanded && showExpand ? "…" : ""}
        </p>
        {showExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-primary mt-1 hover:underline font-mono-share"
          >
            {expanded ? "Show less" : "Show full prompt"}
          </button>
        )}
        {post.negativePrompt && expanded && (
          <div className="mt-3 pt-3 border-t border-border/20">
            <span className="font-orbitron text-[9px] text-muted-foreground tracking-widest">NEGATIVE</span>
            <p className="font-rajdhani text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
              {post.negativePrompt}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleVote("👍")}
          className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
            userVote === "👍" ? "text-primary bg-primary/15" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
        >
          <ArrowBigUp className="w-5 h-5" />
          <span className="font-mono-share text-xs tabular-nums">{score}</span>
        </button>
        <button
          type="button"
          onClick={() => handleVote("👎")}
          className={`p-1 rounded-md transition-colors ${
            userVote === "👎" ? "text-destructive bg-destructive/15" : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          }`}
        >
          <ArrowBigDown className="w-5 h-5" />
        </button>
      </div>
    </Card>
  );
}

export default function PromptsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [sort, setSort] = useState<SortMode>("hot");
  const [prompts, setPrompts] = useState<PromptPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [mode, setMode] = useState("text-to-image");
  const [tagsInput, setTagsInput] = useState("");
  const [exampleImageUrl, setExampleImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requireAuth = useCallback(() => {
    if (isAuthenticated) return true;
    toast({ title: "Sign in required", description: "Create a free account to vote or share prompts." });
    navigate("/create?signup=1");
    return false;
  }, [isAuthenticated, navigate, toast]);

  const fetchPrompts = useCallback(
    async (sortMode: SortMode, nextCursor?: string | null, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ sort: sortMode });
        if (nextCursor) params.set("cursor", nextCursor);
        const data = await apiFetch<{ prompts: PromptPost[]; nextCursor: string | null }>(
          `/prompts?${params.toString()}`,
          { auth: true }
        );
        setPrompts((prev) => (append ? [...prev, ...data.prompts] : data.prompts));
        setCursor(data.nextCursor);
      } catch {
        if (!append) setPrompts([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchPrompts(sort);
  }, [sort, fetchPrompts]);

  useEffect(() => {
    if (searchParams.get("share") !== "1") return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.prompt) setPrompt(String(draft.prompt));
        if (draft.negativePrompt) setNegativePrompt(String(draft.negativePrompt));
        if (draft.mode) setMode(String(draft.mode));
        if (draft.exampleImageUrl) setExampleImageUrl(String(draft.exampleImageUrl));
        if (draft.title) setTitle(String(draft.title));
        setShowForm(true);
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // ignore
    }
    searchParams.delete("share");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleSubmit = async () => {
    if (!requireAuth()) return;
    const promptText = prompt.trim();
    if (!promptText) {
      toast({ title: "Prompt required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const tags = tagsInput
        .split(/[,#\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      await apiFetch("/prompts", {
        method: "POST",
        body: {
          title: title.trim(),
          prompt: promptText,
          negativePrompt: negativePrompt.trim(),
          mode,
          tags,
          exampleImageUrl: exampleImageUrl.trim() || null,
        },
      });
      toast({ title: "Prompt shared!", description: "The community can now vote on it." });
      setTitle("");
      setPrompt("");
      setNegativePrompt("");
      setTagsInput("");
      setExampleImageUrl("");
      setShowForm(false);
      fetchPrompts(sort);
    } catch (err: any) {
      toast({ title: err.message || "Failed to share", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const sortTabs: { id: SortMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "hot", label: "HOT", icon: Flame },
    { id: "top", label: "TOP", icon: Trophy },
    { id: "new", label: "NEW", icon: Clock },
  ];

  return (
    <CyberLayout>
      <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto space-y-5 pb-24">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold font-[Orbitron] text-foreground tracking-wider flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              PROMPT BOARD
            </h1>
            <p className="text-xs text-muted-foreground">Share winning prompts · vote on the best</p>
          </div>
          <Button
            size="sm"
            className="font-orbitron text-[10px] tracking-widest"
            onClick={() => (showForm ? setShowForm(false) : requireAuth() && setShowForm(true))}
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>

        {showForm && (
          <Card className="p-4 border-primary/30 bg-card space-y-3">
            <h2 className="font-orbitron text-xs tracking-widest text-primary">SHARE A PROMPT</h2>
            <Input
              placeholder="Short title (optional) — e.g. Neon cyberpunk portrait"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
            <Textarea
              placeholder="Paste the prompt that worked well…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              maxLength={4000}
            />
            <Textarea
              placeholder="Negative prompt (optional)"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              maxLength={2000}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-xs font-mono-share"
              >
                {MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Tags: portrait, neon, anime"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
            <Input
              placeholder="Example image URL (optional)"
              value={exampleImageUrl}
              onChange={(e) => setExampleImageUrl(e.target.value)}
            />
            <Button
              className="w-full font-orbitron text-xs tracking-widest"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "POSTING…" : "POST TO BOARD"}
            </Button>
          </Card>
        )}

        <div className="flex gap-2">
          {sortTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSort(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-orbitron text-[10px] tracking-widest border transition-colors ${
                sort === id
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-40 rounded-lg bg-muted/20 animate-pulse" />
            ))}
          </div>
        ) : prompts.length === 0 ? (
          <Card className="p-8 text-center space-y-3 border-border bg-card">
            <Sparkles className="w-10 h-10 mx-auto text-primary/50" />
            <p className="text-sm text-muted-foreground">No prompts yet. Be the first to share one that worked!</p>
            <Button variant="outline" size="sm" onClick={() => requireAuth() && setShowForm(true)}>
              Share a prompt
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {prompts.map((p) => (
              <PromptCard
                key={p.id}
                post={p}
                requireAuth={requireAuth}
                onDelete={(id) => setPrompts((prev) => prev.filter((x) => x.id !== id))}
                onVoteChange={(id, score, userVote) =>
                  setPrompts((prev) => prev.map((x) => (x.id === id ? { ...x, score, userVote } : x)))
                }
              />
            ))}
            {cursor && (
              <Button
                variant="outline"
                className="w-full font-orbitron text-[10px] tracking-widest"
                onClick={() => fetchPrompts(sort, cursor, true)}
                disabled={loadingMore}
              >
                {loadingMore ? "LOADING…" : "LOAD MORE"}
              </Button>
            )}
          </div>
        )}
      </div>
    </CyberLayout>
  );
}

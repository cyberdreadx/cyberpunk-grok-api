import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Trash2, Loader2, Eye, Lock, Unlock, Heart, Zap, EyeOff } from "lucide-react";
import XrgeUnlockDialog from "@/components/XrgeUnlockDialog";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMatureFilter } from "@/hooks/useMatureFilter";

interface Story {
  id: string;
  mediaUrl: string;
  previewUrl?: string;
  mediaType: "image" | "video";
  caption: string;
  prompt: string;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
  viewCount?: number;
  likeCount?: number;
  userLiked?: boolean;
  lockCost?: number;
  lockXrgeAmount?: string;
  unlocked?: boolean;
  isOwner?: boolean;
  isMature?: boolean;
}

interface StoryUser {
  userId: string;
  username: string;
  stories: Story[];
  hasUnviewed: boolean;
}

interface StoryViewerProps {
  users: StoryUser[];
  initialUserIdx: number;
  currentUserId?: string;
  isAdmin?: boolean;
  onClose: () => void;
  onViewed: (storyId: string) => void;
  onDelete?: (storyId: string) => Promise<void>;
  onUnlocked?: () => void;
}

interface Viewer {
  userId: string;
  username: string;
  avatarUrl: string | null;
  viewedAt: string;
}

const STORY_DURATION = 5000;

const StoryViewer: React.FC<StoryViewerProps> = ({ users, initialUserIdx, currentUserId, isAdmin, onClose, onViewed, onDelete, onUnlocked }) => {
  const { matureFilter } = useMatureFilter();
  const [matureRevealed, setMatureRevealed] = useState<Record<string, boolean>>({});
  const [userIdx, setUserIdx] = useState(initialUserIdx);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [xrgeUnlockOpen, setXrgeUnlockOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const videoRef = useRef<HTMLVideoElement>(null);

  const swipeRef = useRef({ startX: 0, startY: 0, currentX: 0, currentY: 0, swiping: false, horizSwipe: false, startTime: 0 });
  const [swipeOffset, setSwipeOffset] = useState(0);
  const lastTouchEndRef = useRef(0);
  const lastNavRef = useRef(0);

  const currentUser = users[userIdx];
  const currentStory = currentUser?.stories[storyIdx];
  const isOwner = currentUser?.userId === currentUserId;
  const isLocked = currentStory && ((currentStory.lockCost || 0) > 0 || (currentStory.lockXrgeAmount && parseFloat(currentStory.lockXrgeAmount) > 0)) && !currentStory.unlocked && !currentStory.isOwner;
  const isMatureBlurred = !!currentStory && !isLocked && matureFilter && !!currentStory.isMature && !matureRevealed[currentStory.id] && !currentStory.isOwner;

  // Sync like state when story changes
  useEffect(() => {
    if (currentStory) {
      setLiked(currentStory.userLiked || false);
      setLikeCount(currentStory.likeCount || 0);
      setShowViewers(false);
    }
  }, [currentStory?.id]);

  // Mark as viewed
  useEffect(() => {
    if (currentStory && !currentStory.viewed && !isLocked) {
      onViewed(currentStory.id);
    }
  }, [currentStory?.id, isLocked]);

  // Progress timer
  useEffect(() => {
    if (!currentStory || paused || isLocked || showViewers) return;
    if (currentStory.mediaType === "video") return;
    setProgress(0);
    const interval = 50;
    const steps = STORY_DURATION / interval;
    let step = 0;
    timerRef.current = setInterval(() => {
      step++;
      setProgress((step / steps) * 100);
      if (step >= steps) goNext();
    }, interval);
    return () => clearInterval(timerRef.current);
  }, [currentStory?.id, paused, isLocked, showViewers]);

  const goNext = useCallback(() => {
    if (!currentUser) return;
    if (storyIdx < currentUser.stories.length - 1) {
      setStoryIdx(s => s + 1); setProgress(0);
    } else if (userIdx < users.length - 1) {
      setUserIdx(u => u + 1); setStoryIdx(0); setProgress(0);
    } else {
      onClose();
    }
  }, [storyIdx, userIdx, currentUser, users.length, onClose]);

  const goPrev = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx(s => s - 1); setProgress(0);
    } else if (userIdx > 0) {
      setUserIdx(u => u - 1); setStoryIdx(users[userIdx - 1].stories.length - 1); setProgress(0);
    }
  }, [storyIdx, userIdx, users]);

  const handleVideoEnd = useCallback(() => goNext(), [goNext]);
  const handleVideoTime = useCallback(() => {
    const v = videoRef.current;
    if (v && v.duration) setProgress((v.currentTime / v.duration) * 100);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showViewers) { if (e.key === "Escape") setShowViewers(false); return; }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === " ") { e.preventDefault(); setPaused(p => !p); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, onClose, showViewers]);

  const canDelete = onDelete && currentUser && currentStory && (currentUser.userId === currentUserId || isAdmin);

  const handleDelete = useCallback(async () => {
    if (!onDelete || !currentStory || deleting) return;
    setDeleting(true); setPaused(true);
    try {
      await onDelete(currentStory.id);
      toast.success("Story deleted");
      const remaining = currentUser.stories.length - 1;
      if (remaining <= 0 && userIdx >= users.length - 1) onClose();
      else if (storyIdx >= remaining) setStoryIdx(Math.max(0, remaining - 1));
    } catch { toast.error("Failed to delete story"); }
    finally { setDeleting(false); setPaused(false); }
  }, [onDelete, currentStory, currentUser, deleting, storyIdx, userIdx, users.length, onClose]);

  const handleUnlock = useCallback(async () => {
    if (!currentStory || unlocking) return;
    setUnlocking(true);
    try {
      await apiFetch("/stories", { method: "PATCH", body: { storyId: currentStory.id } });
      toast.success(`Unlocked for ${currentStory.lockCost} credits!`);
      currentStory.unlocked = true;
      currentStory.mediaUrl = "";
      onUnlocked?.();
    } catch (err: any) {
      toast.error(err.message?.includes("Not enough credits") ? "Not enough credits" : (err.message || "Failed to unlock"));
    } finally { setUnlocking(false); }
  }, [currentStory, unlocking, onUnlocked]);

  const handleLike = useCallback(async () => {
    if (!currentStory || isLocked) return;
    const prevLiked = liked;
    const prevCount = likeCount;
    const newLiked = !prevLiked;
    const newCount = prevLiked ? prevCount - 1 : prevCount + 1;
    setLiked(newLiked);
    setLikeCount(newCount);
    // Persist on the underlying story object so navigating away/back keeps state
    currentStory.userLiked = newLiked;
    currentStory.likeCount = newCount;
    try {
      const res = await apiFetch<{ liked: boolean }>("/story-likes", { method: "POST", body: { storyId: currentStory.id } });
      // Reconcile with server truth
      if (typeof res?.liked === "boolean" && res.liked !== newLiked) {
        const corrected = res.liked;
        setLiked(corrected);
        currentStory.userLiked = corrected;
      }
      window.dispatchEvent(new Event("karma-changed"));
    } catch {
      setLiked(prevLiked);
      setLikeCount(prevCount);
      currentStory.userLiked = prevLiked;
      currentStory.likeCount = prevCount;
      toast.error("Failed to like");
    }
  }, [currentStory, isLocked, liked, likeCount]);

  const handleShowViewers = useCallback(async () => {
    if (!currentStory || !isOwner) return;
    setShowViewers(true);
    setPaused(true);
    setLoadingViewers(true);
    try {
      const data = await apiFetch<{ viewers: Viewer[] }>(`/story-viewers?storyId=${currentStory.id}`);
      setViewers(data.viewers || []);
    } catch { toast.error("Failed to load viewers"); }
    finally { setLoadingViewers(false); }
  }, [currentStory, isOwner]);

  // Navigation guard — debounce rapid taps that fire twice (touchend + click)
  const safeNav = useCallback((dir: "next" | "prev") => {
    const now = Date.now();
    if (now - lastNavRef.current < 250) return;
    lastNavRef.current = now;
    if (dir === "next") goNext(); else goPrev();
  }, [goNext, goPrev]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (showViewers) return;
    const t = e.touches[0];
    swipeRef.current = { startX: t.clientX, startY: t.clientY, currentX: t.clientX, currentY: t.clientY, swiping: false, horizSwipe: false, startTime: Date.now() };
    setPaused(true);
  }, [showViewers]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (showViewers) return;
    const t = e.touches[0];
    const deltaX = t.clientX - swipeRef.current.startX;
    const deltaY = t.clientY - swipeRef.current.startY;
    swipeRef.current.currentX = t.clientX;
    swipeRef.current.currentY = t.clientY;
    // Mark as horizontal swipe if X movement dominates
    if (!swipeRef.current.swiping && Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY)) {
      swipeRef.current.horizSwipe = true;
      swipeRef.current.swiping = true;
    }
    // Vertical swipe-down to close — only if clearly vertical
    if (!swipeRef.current.horizSwipe && deltaY > 10 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
      swipeRef.current.swiping = true;
      setSwipeOffset(Math.min(deltaY, 300));
    }
  }, [showViewers]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (showViewers) { setPaused(false); return; }
    lastTouchEndRef.current = Date.now();
    const deltaX = swipeRef.current.currentX - swipeRef.current.startX;
    const deltaY = swipeRef.current.currentY - swipeRef.current.startY;
    const elapsed = Date.now() - swipeRef.current.startTime;

    // Horizontal swipe → navigate
    if (swipeRef.current.horizSwipe && Math.abs(deltaX) > 50) {
      setPaused(false);
      swipeRef.current.swiping = false;
      safeNav(deltaX > 0 ? "prev" : "next");
      return;
    }
    // Vertical swipe down → close
    if (swipeRef.current.swiping && !swipeRef.current.horizSwipe && deltaY > 100) {
      onClose();
      return;
    }
    setSwipeOffset(0);
    setPaused(false);

    // Tap (no swipe, short, minimal movement) → navigate
    if (!swipeRef.current.swiping && elapsed < 400 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
      const touch = e.changedTouches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      // Smaller prev zone (left 25%) to avoid accidental back-tap
      safeNav(x < rect.width * 0.25 ? "prev" : "next");
    }
    swipeRef.current.swiping = false;
    swipeRef.current.horizSwipe = false;
  }, [onClose, safeNav, showViewers]);

  const handleClick = (e: React.MouseEvent) => {
    if (showViewers) return;
    // Suppress synthetic click after touch on mobile (within 500ms)
    if (Date.now() - lastTouchEndRef.current < 500) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    safeNav(x < rect.width * 0.25 ? "prev" : "next");
  };

  if (!currentUser || !currentStory) return null;
  const opacity = Math.max(1 - swipeOffset / 300, 0.3);

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center" style={{ opacity }}>
      {/* Swipe hint */}
      <div className="absolute left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/30 z-20 sm:hidden"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 4px)" }} />

      {/* Progress bars */}
      <div className="absolute left-0 right-0 flex gap-0.5 px-2 z-10"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}>
        {currentUser.stories.map((s, i) => (
          <div key={s.id} className="flex-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all duration-75"
              style={{ width: i < storyIdx ? "100%" : i === storyIdx ? `${progress}%` : "0%" }} />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute left-0 right-0 flex items-center justify-between px-3 z-20"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 20px)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to={`/profile/${currentUser.username}`}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-primary/50 to-secondary/50 flex items-center justify-center text-xs font-bold text-white uppercase">
              {currentUser.username.slice(0, 2)}
            </div>
            <span className="text-white text-sm font-medium truncate hover:underline">{currentUser.username}</span>
          </Link>
          <span className="text-white/50 text-xs shrink-0">
            {new Date(currentStory.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {((currentStory.lockCost || 0) > 0 || (currentStory.lockXrgeAmount && parseFloat(currentStory.lockXrgeAmount) > 0)) && (
            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
              <Lock className="w-3 h-3" />
              {(currentStory.lockCost || 0) > 0 ? currentStory.lockCost : ""}
              {currentStory.lockXrgeAmount && parseFloat(currentStory.lockXrgeAmount) > 0 && (
                <span className="text-secondary ml-1">{currentStory.lockXrgeAmount} XRGE</span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0 shrink-0">
          {currentStory.mediaType === "video" && !isLocked && (
            <button onClick={() => setMuted(m => !m)} className="text-white/80 hover:text-white p-2">
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          )}
          {canDelete && (
            <button onClick={(e) => { e.stopPropagation(); handleDelete(); }} disabled={deleting}
              className="text-red-400/80 hover:text-red-400 p-2 transition-colors">
              {deleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-white/80 hover:text-white p-3" aria-label="Close stories">
            <X className="w-7 h-7" />
          </button>
        </div>
      </div>

      {/* Media */}
      <div className="w-full h-full cursor-pointer select-none"
        style={{ transform: `translateY(${swipeOffset}px)`, touchAction: "pan-y" }}
        onClick={handleClick}
        onMouseDown={(e) => { if (Date.now() - lastTouchEndRef.current < 500) return; if (!isLocked && !showViewers) setPaused(true); }}
        onMouseUp={(e) => { if (Date.now() - lastTouchEndRef.current < 500) return; if (!isLocked && !showViewers) setPaused(false); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isLocked ? (
          <div className="relative w-full h-full flex items-center justify-center">
            {currentStory.previewUrl && (
              currentStory.mediaType === "video" ? (
                <video src={currentStory.previewUrl} className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-60" autoPlay muted loop playsInline />
              ) : (
                <img src={currentStory.previewUrl} alt="" className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-60" />
              )
            )}
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative z-10 flex flex-col items-center gap-5 text-center px-8">
              <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center backdrop-blur-sm">
                <Lock className="w-10 h-10 text-amber-400" />
              </div>
              <div>
                <p className="text-white text-lg font-semibold mb-1">Locked Story</p>
                {(currentStory.lockCost || 0) > 0 && (
                  <p className="text-white/60 text-sm">
                    This story costs <span className="text-amber-400 font-bold">{currentStory.lockCost} credits</span> to view
                  </p>
                )}
                {currentStory.lockXrgeAmount && parseFloat(currentStory.lockXrgeAmount) > 0 && (
                  <p className="text-white/60 text-sm mt-1">
                    Or pay <span className="text-secondary font-bold">{currentStory.lockXrgeAmount} XRGE</span> — instant to creator ⚡
                  </p>
                )}
                <p className="text-white/40 text-xs mt-1">Earnings go to the creator</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {(currentStory.lockCost || 0) > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); handleUnlock(); }} disabled={unlocking}
                    className="flex items-center justify-center gap-2 px-8 py-3 rounded-lg bg-gradient-to-r from-amber-500/80 to-amber-600/80 hover:from-amber-500 hover:to-amber-600 text-white font-semibold text-sm transition-all active:scale-95 disabled:opacity-50">
                    {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                    Unlock for {currentStory.lockCost} credits
                  </button>
                )}
                {currentStory.lockXrgeAmount && parseFloat(currentStory.lockXrgeAmount) > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); setXrgeUnlockOpen(true); }}
                    className="flex items-center justify-center gap-2 px-8 py-3 rounded-lg bg-gradient-to-r from-secondary/60 to-secondary/80 hover:from-secondary/80 hover:to-secondary text-white font-semibold text-sm transition-all active:scale-95">
                    <Zap className="w-4 h-4" />
                    Pay {currentStory.lockXrgeAmount} XRGE ⚡
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : currentStory.mediaType === "video" ? (
          <div className="relative w-full h-full">
            <video ref={videoRef} src={currentStory.mediaUrl}
              className={`w-full h-full object-contain transition-[filter] duration-300 ${isMatureBlurred ? "blur-2xl scale-110" : ""}`}
              autoPlay muted={muted} playsInline
              onEnded={handleVideoEnd} onTimeUpdate={handleVideoTime} />
            {isMatureBlurred && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm z-10">
                <div className="bg-black/70 rounded-full p-3 border border-amber-400/50">
                  <EyeOff className="w-7 h-7 text-amber-300" />
                </div>
                <span className="font-orbitron text-xs tracking-widest text-amber-300">MATURE CONTENT</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setMatureRevealed(p => ({ ...p, [currentStory.id]: true })); }}
                  className="font-mono-share text-xs px-4 py-1.5 rounded-md border border-amber-400/50 text-amber-300 bg-black/40 hover:bg-amber-400/10"
                >REVEAL</button>
              </div>
            )}
          </div>
        ) : (
          <div className="relative w-full h-full">
            <img src={currentStory.mediaUrl} alt={currentStory.caption || "Story"}
              className={`w-full h-full object-contain transition-[filter] duration-300 ${isMatureBlurred ? "blur-2xl scale-110" : ""}`} />
            {isMatureBlurred && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm z-10">
                <div className="bg-black/70 rounded-full p-3 border border-amber-400/50">
                  <EyeOff className="w-7 h-7 text-amber-300" />
                </div>
                <span className="font-orbitron text-xs tracking-widest text-amber-300">MATURE CONTENT</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setMatureRevealed(p => ({ ...p, [currentStory.id]: true })); }}
                  className="font-mono-share text-xs px-4 py-1.5 rounded-md border border-amber-400/50 text-amber-300 bg-black/40 hover:bg-amber-400/10"
                >REVEAL</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      {!isLocked && !showViewers && (
        <div className="absolute left-0 right-0 px-4 z-20 flex flex-col items-center gap-2"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
          
          {/* Like + caption row */}
          <div className="flex items-end gap-3 w-full max-w-md">
            <div className="flex-1 min-w-0">
              {currentStory.caption && (
                <p className="text-white text-sm bg-black/40 rounded-lg px-3 py-2 backdrop-blur-sm break-words line-clamp-3">
                  {currentStory.caption}
                </p>
              )}
            </div>
            <div className="flex flex-col items-center gap-1 shrink-0">
              <button onClick={(e) => { e.stopPropagation(); handleLike(); }}
                className={`p-2.5 rounded-full backdrop-blur-sm transition-all active:scale-90 ${
                  liked ? "bg-red-500/20 text-red-400" : "bg-black/30 text-white/70"
                }`}>
                <Heart className={`w-6 h-6 ${liked ? "fill-current" : ""}`} />
              </button>
              <span className="text-white/60 text-[10px] font-mono-share">{likeCount}</span>
            </div>
          </div>

          {/* View count (owner only) */}
          {(isOwner || isAdmin) && typeof currentStory.viewCount === "number" && (
            <button onClick={(e) => { e.stopPropagation(); handleShowViewers(); }}
              className="flex items-center gap-1.5 text-white/60 text-xs hover:text-white/80 transition-colors">
              <Eye className="w-3.5 h-3.5" />
              <span>{currentStory.viewCount} {currentStory.viewCount === 1 ? "view" : "views"}</span>
            </button>
          )}
        </div>
      )}

      {/* Viewers panel */}
      {showViewers && (
        <div className="absolute inset-x-0 bottom-0 z-30 bg-card/95 backdrop-blur-md rounded-t-2xl max-h-[60dvh] overflow-y-auto"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 pt-3 pb-2 sticky top-0 bg-card/95 backdrop-blur-md z-10 border-b border-border/20">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <span className="font-orbitron text-xs text-foreground tracking-wider">
                {currentStory.viewCount} {currentStory.viewCount === 1 ? "VIEWER" : "VIEWERS"}
              </span>
            </div>
            <button onClick={() => { setShowViewers(false); setPaused(false); }}
              className="font-mono-share text-[10px] text-muted-foreground hover:text-foreground px-2 py-1">
              CLOSE
            </button>
          </div>
          {loadingViewers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : viewers.length === 0 ? (
            <p className="text-center text-muted-foreground text-xs py-8 font-mono-share">No viewers yet</p>
          ) : (
            <div className="divide-y divide-border/10">
              {viewers.map((v) => (
                <Link
                  to={`/profile/${v.username}`}
                  key={v.userId}
                  onClick={() => onClose()}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors"
                >
                  <Avatar className="w-8 h-8 border border-primary/10">
                    {v.avatarUrl && <AvatarImage src={v.avatarUrl} alt={v.username} />}
                    <AvatarFallback className="bg-primary/10 text-primary font-orbitron text-[9px]">
                      {v.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <span className="font-orbitron text-xs text-foreground truncate block">@{v.username}</span>
                    <span className="font-mono-share text-[9px] text-muted-foreground">
                      {new Date(v.viewedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav arrows (desktop) */}
      {userIdx > 0 && (
        <button onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 hidden sm:block">
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      {(storyIdx < currentUser.stories.length - 1 || userIdx < users.length - 1) && (
        <button onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 hidden sm:block">
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {currentStory?.lockXrgeAmount && parseFloat(currentStory.lockXrgeAmount) > 0 && (
        <XrgeUnlockDialog
          open={xrgeUnlockOpen}
          onClose={() => setXrgeUnlockOpen(false)}
          xrgeAmount={currentStory.lockXrgeAmount}
          storyId={currentStory.id}
          onSuccess={() => {
            currentStory.unlocked = true;
            currentStory.mediaUrl = "";
            onUnlocked?.();
            setXrgeUnlockOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default StoryViewer;

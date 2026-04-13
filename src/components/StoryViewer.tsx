import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Trash2, Loader2, Eye, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

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
  lockCost?: number;
  unlocked?: boolean;
  isOwner?: boolean;
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

const STORY_DURATION = 5000;

const StoryViewer: React.FC<StoryViewerProps> = ({ users, initialUserIdx, currentUserId, isAdmin, onClose, onViewed, onDelete, onUnlocked }) => {
  const [userIdx, setUserIdx] = useState(initialUserIdx);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Swipe-down-to-close state
  const swipeRef = useRef({ startY: 0, currentY: 0, swiping: false });
  const [swipeOffset, setSwipeOffset] = useState(0);

  const currentUser = users[userIdx];
  const currentStory = currentUser?.stories[storyIdx];
  const isOwner = currentUser?.userId === currentUserId;
  const isLocked = currentStory && (currentStory.lockCost || 0) > 0 && !currentStory.unlocked && !currentStory.isOwner;

  // Mark as viewed
  useEffect(() => {
    if (currentStory && !currentStory.viewed && !isLocked) {
      onViewed(currentStory.id);
    }
  }, [currentStory?.id, isLocked]);

  // Progress timer — pause if locked
  useEffect(() => {
    if (!currentStory || paused || isLocked) return;
    if (currentStory.mediaType === "video") return;

    setProgress(0);
    const interval = 50;
    const steps = STORY_DURATION / interval;
    let step = 0;

    timerRef.current = setInterval(() => {
      step++;
      setProgress((step / steps) * 100);
      if (step >= steps) {
        goNext();
      }
    }, interval);

    return () => clearInterval(timerRef.current);
  }, [currentStory?.id, paused, isLocked]);

  const goNext = useCallback(() => {
    if (!currentUser) return;
    if (storyIdx < currentUser.stories.length - 1) {
      setStoryIdx(s => s + 1);
      setProgress(0);
    } else if (userIdx < users.length - 1) {
      setUserIdx(u => u + 1);
      setStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  }, [storyIdx, userIdx, currentUser, users.length, onClose]);

  const goPrev = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx(s => s - 1);
      setProgress(0);
    } else if (userIdx > 0) {
      setUserIdx(u => u - 1);
      setStoryIdx(users[userIdx - 1].stories.length - 1);
      setProgress(0);
    }
  }, [storyIdx, userIdx, users]);

  const handleVideoEnd = useCallback(() => {
    goNext();
  }, [goNext]);

  const handleVideoTime = useCallback(() => {
    const v = videoRef.current;
    if (v && v.duration) {
      setProgress((v.currentTime / v.duration) * 100);
    }
  }, []);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === " ") { e.preventDefault(); setPaused(p => !p); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, onClose]);

  const canDelete = onDelete && currentUser && currentStory &&
    (currentUser.userId === currentUserId || isAdmin);

  const handleDelete = useCallback(async () => {
    if (!onDelete || !currentStory || deleting) return;
    setDeleting(true);
    setPaused(true);
    try {
      await onDelete(currentStory.id);
      toast.success("Story deleted");
      const remaining = currentUser.stories.length - 1;
      if (remaining <= 0 && userIdx >= users.length - 1) {
        onClose();
      } else if (storyIdx >= remaining) {
        setStoryIdx(Math.max(0, remaining - 1));
      }
    } catch {
      toast.error("Failed to delete story");
    } finally {
      setDeleting(false);
      setPaused(false);
    }
  }, [onDelete, currentStory, currentUser, deleting, storyIdx, userIdx, users.length, onClose]);

  const handleUnlock = useCallback(async () => {
    if (!currentStory || unlocking) return;
    setUnlocking(true);
    try {
      await apiFetch("/stories", { method: "PATCH", body: { storyId: currentStory.id } });
      toast.success(`Unlocked for ${currentStory.lockCost} credits!`);
      // Mutate local state to show unlocked
      currentStory.unlocked = true;
      currentStory.mediaUrl = ""; // will refresh on next fetch
      onUnlocked?.();
    } catch (err: any) {
      if (err.message?.includes("Not enough credits")) {
        toast.error("Not enough credits to unlock this story");
      } else {
        toast.error(err.message || "Failed to unlock");
      }
    } finally {
      setUnlocking(false);
    }
  }, [currentStory, unlocking, onUnlocked]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    swipeRef.current = { startY: touch.clientY, currentY: touch.clientY, swiping: false };
    setPaused(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const deltaY = touch.clientY - swipeRef.current.startY;
    swipeRef.current.currentY = touch.clientY;
    if (deltaY > 10) {
      swipeRef.current.swiping = true;
      setSwipeOffset(Math.min(deltaY, 300));
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const deltaY = swipeRef.current.currentY - swipeRef.current.startY;
    if (swipeRef.current.swiping && deltaY > 100) {
      onClose();
      return;
    }
    setSwipeOffset(0);
    if (!swipeRef.current.swiping) {
      const touch = e.changedTouches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      if (x < rect.width / 3) goPrev();
      else goNext();
    }
    setPaused(false);
    swipeRef.current.swiping = false;
  }, [onClose, goPrev, goNext, isLocked]);

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) goPrev();
    else goNext();
  };

  if (!currentUser || !currentStory) return null;

  const opacity = Math.max(1 - swipeOffset / 300, 0.3);

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center"
      style={{ opacity }}
    >
      {/* Swipe-down hint */}
      <div className="absolute left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/30 z-20 sm:hidden"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 4px)" }}
      />

      {/* Progress bars */}
      <div className="absolute left-0 right-0 flex gap-0.5 px-2 z-10"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
      >
        {currentUser.stories.map((s, i) => (
          <div key={s.id} className="flex-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-75"
              style={{
                width: i < storyIdx ? "100%" : i === storyIdx ? `${progress}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute left-0 right-0 flex items-center justify-between px-3 z-20"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 20px)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-primary/50 to-secondary/50 flex items-center justify-center text-xs font-bold text-white uppercase">
            {currentUser.username.slice(0, 2)}
          </div>
          <span className="text-white text-sm font-medium truncate">{currentUser.username}</span>
          <span className="text-white/50 text-xs shrink-0">
            {new Date(currentStory.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {(currentStory.lockCost || 0) > 0 && (
            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
              <Lock className="w-3 h-3" />
              {currentStory.lockCost}
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
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              disabled={deleting}
              className="text-red-400/80 hover:text-red-400 p-2 transition-colors"
            >
              {deleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-white/80 hover:text-white p-3"
            aria-label="Close stories"
          >
            <X className="w-7 h-7" />
          </button>
        </div>
      </div>

      {/* Media / Lock overlay */}
      <div
        className="w-full h-full flex items-center justify-center cursor-pointer select-none"
        style={{ transform: `translateY(${swipeOffset}px)` }}
        onClick={handleClick}
        onMouseDown={() => !isLocked && setPaused(true)}
        onMouseUp={() => !isLocked && setPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isLocked ? (
          /* Locked story overlay with blurred preview */
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Blurred preview background */}
            {currentStory.previewUrl && (
              currentStory.mediaType === "video" ? (
                <video
                  src={currentStory.previewUrl}
                  className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-60"
                  autoPlay muted loop playsInline
                />
              ) : (
                <img
                  src={currentStory.previewUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-60"
                />
              )
            )}
            {/* Dark overlay on top of blur */}
            <div className="absolute inset-0 bg-black/50" />
            {/* Unlock card */}
            <div className="relative z-10 flex flex-col items-center gap-5 text-center px-8">
              <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center backdrop-blur-sm">
                <Lock className="w-10 h-10 text-amber-400" />
              </div>
              <div>
                <p className="text-white text-lg font-semibold mb-1">Locked Story</p>
                <p className="text-white/60 text-sm">
                  This story costs <span className="text-amber-400 font-bold">{currentStory.lockCost} credits</span> to view
                </p>
                <p className="text-white/40 text-xs mt-1">Credits go to the creator</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleUnlock(); }}
                disabled={unlocking}
                className="flex items-center gap-2 px-8 py-3 rounded-lg bg-gradient-to-r from-amber-500/80 to-amber-600/80 hover:from-amber-500 hover:to-amber-600 text-white font-semibold text-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {unlocking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Unlock className="w-4 h-4" />
                )}
                Unlock for {currentStory.lockCost} credits
              </button>
            </div>
          </div>
        ) : currentStory.mediaType === "video" ? (
          <video
            ref={videoRef}
            src={currentStory.mediaUrl}
            className="max-w-full max-h-full object-contain"
            autoPlay
            muted={muted}
            playsInline
            onEnded={handleVideoEnd}
            onTimeUpdate={handleVideoTime}
          />
        ) : (
          <img
            src={currentStory.mediaUrl}
            alt={currentStory.caption || "Story"}
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>

      {/* Bottom bar: caption + view count */}
      {!isLocked && (
        <div className="absolute left-0 right-0 px-6 z-10 flex flex-col items-center gap-2"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 48px)" }}
        >
          {currentStory.caption && (
            <p className="text-white text-sm bg-black/40 rounded-lg px-4 py-2 inline-block backdrop-blur-sm max-w-[90%] text-center">
              {currentStory.caption}
            </p>
          )}
          {(isOwner || isAdmin) && typeof currentStory.viewCount === "number" && (
            <div className="flex items-center gap-1.5 text-white/60 text-xs">
              <Eye className="w-3.5 h-3.5" />
              <span>{currentStory.viewCount} {currentStory.viewCount === 1 ? "view" : "views"}</span>
            </div>
          )}
        </div>
      )}

      {/* Nav arrows (desktop) */}
      {userIdx > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 hidden sm:block"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      {(storyIdx < currentUser.stories.length - 1 || userIdx < users.length - 1) && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 hidden sm:block"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}
    </div>
  );
};

export default StoryViewer;

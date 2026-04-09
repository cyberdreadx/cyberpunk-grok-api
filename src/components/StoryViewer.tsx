import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Story {
  id: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
  prompt: string;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
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
}

const STORY_DURATION = 5000;

const StoryViewer: React.FC<StoryViewerProps> = ({ users, initialUserIdx, currentUserId, isAdmin, onClose, onViewed, onDelete }) => {
  const [userIdx, setUserIdx] = useState(initialUserIdx);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentUser = users[userIdx];
  const currentStory = currentUser?.stories[storyIdx];

  // Mark as viewed
  useEffect(() => {
    if (currentStory && !currentStory.viewed) {
      onViewed(currentStory.id);
    }
  }, [currentStory?.id]);

  // Progress timer
  useEffect(() => {
    if (!currentStory || paused) return;
    if (currentStory.mediaType === "video") return; // video controls its own progress

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
  }, [currentStory?.id, paused]);

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

  // Video ended → next
  const handleVideoEnd = useCallback(() => {
    goNext();
  }, [goNext]);

  // Video time update for progress
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

  // Touch: tap left = prev, tap right = next, hold = pause
  const handleTap = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) goPrev();
    else goNext();
  };

  if (!currentUser || !currentStory) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 flex gap-0.5 p-2 z-10">
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
      <div className="absolute top-4 left-0 right-0 flex items-center justify-between px-4 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/50 to-secondary/50 flex items-center justify-center text-xs font-bold text-white uppercase">
            {currentUser.username.slice(0, 2)}
          </div>
          <span className="text-white text-sm font-medium">{currentUser.username}</span>
          <span className="text-white/50 text-xs">
            {new Date(currentStory.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {currentStory.mediaType === "video" && (
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
          <button onClick={onClose} className="text-white/80 hover:text-white p-2">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Media */}
      <div
        className="w-full h-full flex items-center justify-center cursor-pointer"
        onClick={handleTap}
        onMouseDown={() => setPaused(true)}
        onMouseUp={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        {currentStory.mediaType === "video" ? (
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

      {/* Caption */}
      {currentStory.caption && (
        <div className="absolute bottom-16 left-0 right-0 text-center px-8 z-10">
          <p className="text-white text-sm bg-black/40 rounded-lg px-4 py-2 inline-block backdrop-blur-sm">
            {currentStory.caption}
          </p>
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

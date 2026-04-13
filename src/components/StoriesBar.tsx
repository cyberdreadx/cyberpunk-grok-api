import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { hasAuthToken } from "@/lib/api";
import StoryViewer from "@/components/StoryViewer";

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

interface StoriesBarProps {
  currentUserId?: string;
  isAdmin?: boolean;
}

const StoriesBar: React.FC<StoriesBarProps> = ({ currentUserId, isAdmin }) => {
  const [users, setUsers] = useState<StoryUser[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeUserIdx, setActiveUserIdx] = useState(0);

  // Only fetch if logged in
  const loggedIn = hasAuthToken();

  const fetchStories = useCallback(async () => {
    if (!loggedIn) return;
    try {
      const data = await apiFetch<{ users: StoryUser[] }>("/stories");
      setUsers(data.users || []);
    } catch (err) {
      console.error("[StoriesBar] fetch failed:", err);
    }
  }, [loggedIn]);

  const handleDelete = useCallback(async (storyId: string) => {
    try {
      await apiFetch(`/stories?id=${storyId}`, { method: "DELETE" });
      setUsers(prev => {
        const updated = prev.map(u => ({
          ...u,
          stories: u.stories.filter(s => s.id !== storyId),
        })).filter(u => u.stories.length > 0);
        return updated;
      });
    } catch (err) {
      console.error("[StoriesBar] delete failed:", err);
      throw err;
    }
  }, []);

  const handleViewed = useCallback((storyId: string) => {
    setUsers(prev =>
      prev.map(u => ({
        ...u,
        stories: u.stories.map(s => s.id === storyId ? { ...s, viewed: true } : s),
        hasUnviewed: u.stories.some(s => s.id !== storyId && !s.viewed),
      }))
    );
    apiFetch("/stories", { method: "PUT", body: { storyId } }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchStories();
    const interval = setInterval(fetchStories, 60000);
    const onPosted = () => fetchStories();
    window.addEventListener("story-posted", onPosted);
    return () => {
      clearInterval(interval);
      window.removeEventListener("story-posted", onPosted);
    };
  }, [fetchStories]);

  if (!loggedIn || users.length === 0) return null;

  // Sort: users with free (unlocked) stories first, then locked-only users
  const sortedUsers = [...users].sort((a, b) => {
    const aHasFree = a.stories.some(s => !s.lockCost || s.lockCost === 0 || s.unlocked || s.isOwner);
    const bHasFree = b.stories.some(s => !s.lockCost || s.lockCost === 0 || s.unlocked || s.isOwner);
    if (aHasFree && !bHasFree) return -1;
    if (!aHasFree && bHasFree) return 1;
    // Then unviewed first
    if (a.hasUnviewed && !b.hasUnviewed) return -1;
    if (!a.hasUnviewed && b.hasUnviewed) return 1;
    return 0;
  });

  const openStory = (idx: number) => {
    setActiveUserIdx(idx);
    setViewerOpen(true);
  };

  return (
    <>
      <style>{`
        @keyframes story-ring-spin {
          to { --story-angle: 360deg; }
        }
        @property --story-angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: false;
        }
        .story-ring-active {
          background: conic-gradient(
            from var(--story-angle),
            hsl(var(--primary)),
            hsl(var(--secondary)),
            hsl(var(--primary))
          );
          animation: story-ring-spin 3s linear infinite;
        }
        .story-ring-viewed {
          background: hsl(var(--muted-foreground) / 0.25);
        }
      `}</style>

      <div className="flex gap-4 overflow-x-auto pb-3 px-1 scrollbar-hide">
        {/* Use sortedUsers but map back to original index for viewer */}
        {sortedUsers.map((u) => {
          const originalIdx = users.findIndex(ou => ou.userId === u.userId);
          return (
          <button
            key={u.userId}
            onClick={() => openStory(originalIdx)}
            className="flex flex-col items-center gap-1.5 shrink-0 group"
          >
            <div
              className={`relative w-[62px] h-[62px] sm:w-[70px] sm:h-[70px] rounded-full p-[2.5px] transition-transform duration-200 group-hover:scale-110 group-active:scale-95 ${
                u.hasUnviewed ? "story-ring-active" : "story-ring-viewed"
              }`}
            >
              <div className="w-full h-full rounded-full bg-background flex items-center justify-center overflow-hidden">
                <div
                  className={`w-full h-full rounded-full flex items-center justify-center transition-all ${
                    u.hasUnviewed
                      ? "bg-gradient-to-br from-primary/20 via-background to-secondary/20"
                      : "bg-muted/40"
                  }`}
                >
                  <span
                    className={`font-mono-share text-sm sm:text-base font-bold uppercase tracking-wider ${
                      u.hasUnviewed ? "text-primary" : "text-muted-foreground/60"
                    }`}
                  >
                    {u.username.slice(0, 2)}
                  </span>
                </div>
              </div>
              {u.hasUnviewed && (
                <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
              )}
            </div>
            <span
              className={`font-mono-share text-[10px] truncate max-w-[64px] transition-colors ${
                u.hasUnviewed ? "text-foreground/80" : "text-muted-foreground/50"
              }`}
            >
              {u.username}
            </span>
          </button>
          );
        })}
      </div>

      {viewerOpen && users[activeUserIdx] && (
        <StoryViewer
          users={users}
          initialUserIdx={activeUserIdx}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onClose={() => setViewerOpen(false)}
          onViewed={handleViewed}
          onDelete={handleDelete}
          onUnlocked={fetchStories}
        />
      )}
    </>
  );
};

export default StoriesBar;

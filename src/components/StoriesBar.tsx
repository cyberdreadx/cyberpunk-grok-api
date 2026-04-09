import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import StoryViewer from "@/components/StoryViewer";

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

const StoriesBar: React.FC = () => {
  const [users, setUsers] = useState<StoryUser[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeUserIdx, setActiveUserIdx] = useState(0);

  const fetchStories = useCallback(async () => {
    try {
      const data = await apiFetch<{ users: StoryUser[] }>("/stories");
      setUsers(data.users || []);
    } catch {
      // silent — stories are non-critical
    }
  }, []);

  useEffect(() => {
    fetchStories();
    const interval = setInterval(fetchStories, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [fetchStories]);

  if (users.length === 0) return null;

  const openStory = (idx: number) => {
    setActiveUserIdx(idx);
    setViewerOpen(true);
  };

  const handleViewed = (storyId: string) => {
    // Mark locally
    setUsers(prev =>
      prev.map(u => ({
        ...u,
        stories: u.stories.map(s => s.id === storyId ? { ...s, viewed: true } : s),
        hasUnviewed: u.stories.some(s => s.id !== storyId && !s.viewed),
      }))
    );
    // Fire-and-forget API call
    apiFetch("/stories", { method: "PUT", body: { storyId } }).catch(() => {});
  };

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2 px-1 scrollbar-hide">
        {users.map((u, idx) => (
          <button
            key={u.userId}
            onClick={() => openStory(idx)}
            className="flex flex-col items-center gap-1 shrink-0 group"
          >
            <div
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-xs font-bold uppercase
                ${u.hasUnviewed
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "ring-2 ring-muted-foreground/30 ring-offset-2 ring-offset-background opacity-70"
                }
                bg-gradient-to-br from-primary/30 to-secondary/30 transition-all group-hover:scale-105`}
            >
              <span className="text-foreground text-sm">{u.username.slice(0, 2)}</span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[60px]">
              {u.username}
            </span>
          </button>
        ))}
      </div>

      {viewerOpen && users[activeUserIdx] && (
        <StoryViewer
          users={users}
          initialUserIdx={activeUserIdx}
          onClose={() => setViewerOpen(false)}
          onViewed={handleViewed}
        />
      )}
    </>
  );
};

export default StoriesBar;

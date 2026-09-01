/**
 * Persistence for Easy mode threads.
 *
 * The thread used to live in React state and die on reload. This keeps the
 * conversation in the database while the renders themselves stay exactly where
 * they were — in the Library. Deleting a chat never deletes anyone's art.
 *
 * Every write is best-effort: if persistence fails the chat keeps working in
 * memory rather than blocking a generation the user already paid for.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface ThreadSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "result";
  text: string | null;
  status: "running" | "done" | "error" | null;
  error: string | null;
  assets: { url: string; previewUrl?: string; type: "image" | "video" }[];
  label: string | null;
}

/** The last thread the user had open, so a reload lands where they left off. */
const LAST_KEY = "easy-last-thread";

function readLast(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
function writeLast(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch { /* private mode */ }
}

export function useEasyThreads(enabled: boolean) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshThreads = useCallback(async () => {
    if (!enabled) return;
    try {
      const d = await apiFetch<{ threads: ThreadSummary[] }>("/easy-threads?action=list");
      setThreads(d.threads || []);
    } catch { /* offline or signed out — the chat still works in memory */ }
  }, [enabled]);

  useEffect(() => { void refreshThreads(); }, [refreshThreads]);

  /** Restore whichever thread was last open, once, on mount. */
  useEffect(() => {
    if (!enabled || activeId) return;
    const last = readLast();
    if (last) setActiveId(last);
  }, [enabled, activeId]);

  const loadMessages = useCallback(async (threadId: string): Promise<StoredMessage[]> => {
    setLoading(true);
    try {
      const d = await apiFetch<{ messages: StoredMessage[] }>(`/easy-threads?threadId=${encodeURIComponent(threadId)}`);
      return d.messages || [];
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createThread = useCallback(async (title: string): Promise<string | null> => {
    try {
      const d = await apiFetch<{ thread: ThreadSummary }>("/easy-threads", {
        method: "POST",
        body: { action: "create", title: title.slice(0, 120) },
      });
      setThreads((p) => [d.thread, ...p]);
      return d.thread.id;
    } catch {
      return null;
    }
  }, []);

  const append = useCallback(async (
    threadId: string,
    msg: Partial<StoredMessage> & { role: "user" | "result" },
  ): Promise<string | null> => {
    try {
      const d = await apiFetch<{ id: string }>("/easy-threads", {
        method: "POST",
        body: { action: "append", threadId, ...msg },
      });
      return d.id;
    } catch {
      return null;
    }
  }, []);

  const update = useCallback(async (
    messageId: string,
    patch: { status?: string; error?: string; assets?: StoredMessage["assets"] },
  ): Promise<void> => {
    try {
      await apiFetch("/easy-threads", { method: "POST", body: { action: "update", messageId, ...patch } });
    } catch { /* best effort */ }
  }, []);

  const remove = useCallback(async (threadId: string): Promise<void> => {
    setThreads((p) => p.filter((t) => t.id !== threadId));
    if (activeId === threadId) {
      setActiveId(null);
      writeLast(null);
    }
    try {
      await apiFetch("/easy-threads", { method: "POST", body: { action: "delete", threadId } });
    } catch {
      void refreshThreads(); // put it back if the delete did not land
    }
  }, [activeId, refreshThreads]);

  const rename = useCallback(async (threadId: string, title: string): Promise<void> => {
    setThreads((p) => p.map((t) => (t.id === threadId ? { ...t, title } : t)));
    try {
      await apiFetch("/easy-threads", { method: "POST", body: { action: "rename", threadId, title } });
    } catch { /* best effort */ }
  }, []);

  const selectThread = useCallback((id: string | null) => {
    setActiveId(id);
    writeLast(id);
  }, []);

  return {
    threads, activeId, loading,
    selectThread, createThread, loadMessages, append, update, remove, rename, refreshThreads,
  };
}

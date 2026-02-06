import { useState, useCallback } from "react";

const STORAGE_KEY = "grok-prompt-history";
const MAX_HISTORY = 50;

export interface PromptHistoryEntry {
  id: string;
  prompt: string;
  mode: string;
  timestamp: number;
}

function loadHistory(): PromptHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: PromptHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}

export function usePromptHistory() {
  const [history, setHistory] = useState<PromptHistoryEntry[]>(loadHistory);

  const addEntry = useCallback((prompt: string, mode: string) => {
    setHistory((prev) => {
      // Deduplicate: remove if same prompt already exists
      const filtered = prev.filter((e) => e.prompt !== prompt);
      const next = [
        { id: `ph-${Date.now()}`, prompt, mode, timestamp: Date.now() },
        ...filtered,
      ].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  const removeEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { history, addEntry, removeEntry, clearHistory };
}

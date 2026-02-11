/**
 * Folder management hook — manages folders stored in IndexedDB.
 * Handles CRUD operations, selection state, and moving results between folders.
 * Errors are thrown to callers so they can surface them via toast/UI.
 */

import { useState, useEffect, useCallback } from "react";
import {
  loadFolders,
  createFolder as createFolderStorage,
  renameFolder as renameFolderStorage,
  deleteFolder as deleteFolderStorage,
  moveResultToFolder as moveResultStorage,
  type Folder,
} from "@/lib/storage";

/** Filter modes: show all, unfiled only, none (empty), or a specific folder */
export type FolderFilter = "all" | "unfiled" | "none" | string;

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<FolderFilter>("none");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load folders from IndexedDB on mount
  useEffect(() => {
    loadFolders()
      .then(setFolders)
      .catch((err) => {
        console.error("[useFolders] Failed to load folders:", err);
        setError("Failed to load folders");
      })
      .finally(() => setLoading(false));
  }, []);

  const createFolder = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Folder name cannot be empty");
    if (trimmed.length > 50) throw new Error("Folder name too long (max 50 characters)");

    const folder = await createFolderStorage(trimmed);
    setFolders((prev) => [...prev, folder]);
    return folder;
  }, []);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Folder name cannot be empty");
    if (trimmed.length > 50) throw new Error("Folder name too long (max 50 characters)");

    await renameFolderStorage(id, trimmed);
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
    );
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    await deleteFolderStorage(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    // If the deleted folder was selected, go back to "none"
    setSelectedFilter((prev) => (prev === id ? "none" : prev));
  }, []);

  /**
   * Move a result to a folder (or null for unfiled).
   * Returns the updated folderId so the caller can update React state.
   */
  const moveToFolder = useCallback(async (resultId: string, folderId: string | null) => {
    await moveResultStorage(resultId, folderId);
    return folderId;
  }, []);

  const selectFilter = useCallback((filter: FolderFilter) => {
    setSelectedFilter(filter);
  }, []);

  return {
    folders,
    selectedFilter,
    loading,
    error,
    createFolder,
    renameFolder,
    deleteFolder,
    moveToFolder,
    selectFilter,
  };
}

/**
 * Folder management hook — manages folders stored in IndexedDB.
 * Handles CRUD operations, selection state, and moving results between folders.
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

/** Filter modes: show all, unfiled only, or a specific folder */
export type FolderFilter = "all" | "unfiled" | string;

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<FolderFilter>("all");
  const [loading, setLoading] = useState(true);

  // Load folders from IndexedDB on mount
  useEffect(() => {
    loadFolders()
      .then(setFolders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const createFolder = useCallback(async (name: string) => {
    const folder = await createFolderStorage(name);
    setFolders((prev) => [...prev, folder]);
    return folder;
  }, []);

  const renameFolder = useCallback(async (id: string, name: string) => {
    await renameFolderStorage(id, name);
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name } : f))
    );
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    await deleteFolderStorage(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    // If the deleted folder was selected, go back to "all"
    setSelectedFilter((prev) => (prev === id ? "all" : prev));
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
    createFolder,
    renameFolder,
    deleteFolder,
    moveToFolder,
    selectFilter,
  };
}

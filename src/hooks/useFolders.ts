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
  moveResultsToFolder as moveResultsBulkStorage,
  setFolderHidden as setFolderHiddenStorage,
  deleteStoredResults as deleteResultsBulkStorage,
  emptyTrash as emptyTrashStorage,
  type Folder,
  TRASH_FOLDER_ID,
} from "@/lib/storage";

/** Filter modes: show all, unfiled only, or a specific folder */
export type FolderFilter = "all" | "unfiled" | string;

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  // Default landing tab on app load
  const [selectedFilter, setSelectedFilter] = useState<FolderFilter>("unfiled");
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
    // If the deleted folder was selected, go back to "unfiled"
    setSelectedFilter((prev) => (prev === id ? "unfiled" : prev));
  }, []);

  const toggleFolderHidden = useCallback(async (id: string) => {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const nextHidden = !folder.hidden;
    await setFolderHiddenStorage(id, nextHidden);
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, hidden: nextHidden } : f))
    );
    // If a now-hidden folder was selected, return to unfiled
    if (nextHidden && selectedFilter === id) {
      setSelectedFilter("unfiled");
    }
  }, [folders, selectedFilter]);

  /**
   * Move a result to a folder (or null for unfiled).
   * Returns the updated folderId so the caller can update React state.
   */
  const moveToFolder = useCallback(async (resultId: string, folderId: string | null) => {
    await moveResultStorage(resultId, folderId);
    return folderId;
  }, []);

  const bulkMoveToFolder = useCallback(async (ids: string[], folderId: string | null) => {
    await moveResultsBulkStorage(ids, folderId);
    return folderId;
  }, []);

  const bulkDelete = useCallback(async (ids: string[]) => {
    await deleteResultsBulkStorage(ids);
  }, []);

  const emptyTrashFolder = useCallback(async (): Promise<string[]> => {
    const { deletedIds, urls } = await emptyTrashStorage();
    // Tear down any public /s/:id shares behind the deleted results (privacy
    // promise: deleting a result also kills its share link). Best-effort.
    if (deletedIds.length > 0) {
      import("@/lib/shareLinks")
        .then(({ revokeSharesForResults }) => revokeSharesForResults(deletedIds))
        .catch(() => {});
    }
    // Best-effort: ask the backend to purge any owned blob/R2 objects behind those URLs.
    // Failures here must never block the local trash deletion.
    if (urls.length > 0) {
      try {
        const { apiFetch } = await import("@/lib/api");
        await apiFetch("/library-purge", { method: "POST", body: { urls } }).catch((err: any) => {
          console.warn("[trash] backend purge failed:", err?.message || err);
        });
      } catch (err: any) {
        console.warn("[trash] purge dispatch failed:", err?.message || err);
      }
    }
    return deletedIds;
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
    toggleFolderHidden,
    moveToFolder,
    bulkMoveToFolder,
    bulkDelete,
    emptyTrashFolder,
    selectFilter,
    TRASH_FOLDER_ID,
  };
}

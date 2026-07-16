/**
 * IndexedDB storage layer for Grok results and folders.
 *
 * Replaces localStorage which was limited to ~5-10 MB (a few base64 images).
 * IndexedDB supports hundreds of MB and stores binary blobs natively.
 *
 * Schema:
 *   Database: "grok-media-db" v2
 *   Object store: "results"
 *     key: id (string)
 *     value: { id, type, revised_prompt, timestamp, blob, url, folderId }
 *     indexes: folderId
 *   Object store: "folders"
 *     key: id (string)
 *     value: { id, name, createdAt, order }
 *
 * Images are stored as Blobs (not base64 strings), saving ~33% memory.
 * On read, blobs are surfaced as object URLs via URL.createObjectURL().
 */

/** Local copy of GrokResult to avoid circular import with useGrokApi.ts */
interface GrokResult {
  id: string;
  url: string;
  revised_prompt?: string;
  type: "image" | "video";
  timestamp: number;
  folderId?: string | null;
}

import { apiUrl } from "@/lib/api";

const DB_NAME = "grok-media-db";
const DB_VERSION = 3;
const STORE_NAME = "results";
const FOLDERS_STORE_NAME = "folders";
const CHAT_STORE_NAME = "chat_messages";
const OLD_STORAGE_KEY = "grok-results";

// ── Constants ────────────────────────────────────────────────────────────

export const TRASH_FOLDER_ID = "__trash";

// ── Types ────────────────────────────────────────────────────────────────

export interface StoredResult {
  id: string;
  type: "image" | "video";
  revised_prompt?: string;
  timestamp: number;
  blob: Blob | null; // null for video (external URL kept as-is)
  url: string; // original URL for videos, empty string for images (rebuilt via objectURL)
  folderId?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  order: number;
  /** When true, folder is hidden from the main bar (can be unhidden) */
  hidden?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Open (or create/upgrade) the IndexedDB database. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // v0 → v1: Create results store
      if (oldVersion < 1) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }

      // v1 → v2: Create folders store + add folderId index on results
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(FOLDERS_STORE_NAME)) {
          db.createObjectStore(FOLDERS_STORE_NAME, { keyPath: "id" });
        }
        const resultsStore = request.transaction!.objectStore(STORE_NAME);
        if (!resultsStore.indexNames.contains("folderId")) {
          resultsStore.createIndex("folderId", "folderId", { unique: false });
        }
      }

      // v2 → v3: Create chat messages store for AI companion mode
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(CHAT_STORE_NAME)) {
          const chatStore = db.createObjectStore(CHAT_STORE_NAME, { keyPath: "id", autoIncrement: true });
          chatStore.createIndex("characterId", "characterId", { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Convert a data-URL (e.g. "data:image/png;base64,...") into a Blob. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "application/octet-stream";
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Convert a Blob back into a data-URL string. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Results API ──────────────────────────────────────────────────────────

/**
 * Save a single GrokResult into IndexedDB.
 * Images (data URLs) are converted to Blobs for efficient storage.
 * Videos keep their original URL since they're served externally.
 */
export async function saveResult(result: GrokResult): Promise<void> {
  const record: StoredResult = {
    id: result.id,
    type: result.type,
    revised_prompt: result.revised_prompt,
    timestamp: result.timestamp,
    blob: null,
    url: "",
    folderId: result.folderId || null,
  };

  if (result.url.startsWith("data:")) {
    record.blob = dataUrlToBlob(result.url);
    record.url = "";
  } else if (result.url.startsWith("blob:")) {
    // blob: URLs are session-scoped and die on page reload — fetch the blob
    // and persist it so the video/image survives across sessions.
    try {
      const resp = await fetch(result.url);
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob.size > 0) {
          record.blob = blob;
        }
      }
    } catch { /* blob URL already revoked */ }
    // Never store a raw blob: URL — it won't survive page reload.
    // If we failed to persist the blob, store nothing (the result will be lost
    // rather than broken — better than sending a dead URL as fake base64 later).
    if (!record.blob) {
      console.warn(`[storage] Failed to persist blob: URL for ${result.id}, result may not survive reload`);
      record.url = "";
    }
  } else if (result.url && result.type === "video" && result.url.startsWith("http")) {
    // External video URLs (e.g. signed S3) expire — fetch and persist the blob
    // so playback works long after the URL expires.
    try {
      const resp = await fetch(result.url);
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob.size > 0 && blob.size < 200 * 1024 * 1024) {
          record.blob = blob;
        } else {
          record.url = result.url;
        }
      } else {
        record.url = result.url;
      }
    } catch {
      record.url = result.url;
    }
  } else {
    record.url = result.url;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Save multiple GrokResults at once (single transaction).
 */
export async function saveResults(results: GrokResult[]): Promise<void> {
  if (results.length === 0) return;

  // Pre-fetch any blob:/video URLs before opening the IDB transaction
  // (IDB transactions auto-commit if they go idle during async work)
  const records: StoredResult[] = [];
  for (const result of results) {
    const record: StoredResult = {
      id: result.id,
      type: result.type,
      revised_prompt: result.revised_prompt,
      timestamp: result.timestamp,
      blob: null,
      url: "",
      folderId: result.folderId || null,
    };

    if (result.url.startsWith("data:")) {
      record.blob = dataUrlToBlob(result.url);
    } else if (result.url.startsWith("blob:")) {
      try {
        const resp = await fetch(result.url);
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size > 0) record.blob = blob;
        }
      } catch { /* blob already revoked */ }
      if (!record.blob) {
        console.warn(`[storage] Failed to persist blob: URL for ${result.id}`);
        record.url = "";
      }
    } else if (result.url && result.type === "video" && result.url.startsWith("http")) {
      try {
        const resp = await fetch(result.url);
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size > 0 && blob.size < 200 * 1024 * 1024) {
            record.blob = blob;
          } else {
            record.url = result.url;
          }
        } else {
          record.url = result.url;
        }
      } catch {
        record.url = result.url;
      }
    } else {
      record.url = result.url;
    }
    records.push(record);
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const record of records) store.put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Load all persisted results from IndexedDB, sorted newest-first.
 * Image blobs are converted to object URLs for display.
 * Returns { results, revokeAll } — call revokeAll() on unmount to free memory.
 */
export async function loadResults(): Promise<{
  results: GrokResult[];
  revokeAll: () => void;
}> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      const records: StoredResult[] = request.result;
      const objectUrls: string[] = [];

      const results: GrokResult[] = records.map((rec) => {
        let url: string;
        if (rec.blob && rec.blob instanceof Blob && rec.blob.size > 0) {
          url = URL.createObjectURL(rec.blob);
          objectUrls.push(url);
        } else {
          url = rec.url;
        }
        return {
          id: rec.id,
          type: rec.type,
          revised_prompt: rec.revised_prompt,
          timestamp: rec.timestamp,
          url,
          folderId: rec.folderId || null,
        };
      });

      // Sort newest first
      results.sort((a, b) => b.timestamp - a.timestamp);

      resolve({
        results,
        revokeAll: () => objectUrls.forEach((u) => URL.revokeObjectURL(u)),
      });
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/**
 * One-time-per-item migration: pull URL-only library entries (media whose
 * bytes live only in cloud storage) down into local IndexedDB blobs, so the
 * cloud copy can eventually be deleted without breaking anyone's library.
 * R2's public dev domain doesn't send CORS headers, so bytes come via the
 * /api/download proxy. Runs in the background; items that fail (offline,
 * object already gone) are retried next session.
 */
export async function repersistRemoteResults(maxPerRun = 30): Promise<number> {
  const { isPermanentPublicMediaUrl } = await import("./mediaUpload");
  const { apiUrl } = await import("./api");

  const db = await openDB();
  const records: StoredResult[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const rq = tx.objectStore(STORE_NAME).getAll();
    rq.onsuccess = () => { db.close(); resolve(rq.result || []); };
    rq.onerror = () => { db.close(); reject(rq.error); };
  });

  const candidates = records
    .filter((r) => !(r.blob instanceof Blob && r.blob.size > 0))
    .filter((r) => r.url && /^https?:/i.test(r.url) && isPermanentPublicMediaUrl(r.url))
    .slice(0, maxPerRun);

  let migrated = 0;
  for (const rec of candidates) {
    try {
      const resp = await fetch(apiUrl(`/download?url=${encodeURIComponent(rec.url)}`));
      if (!resp.ok) continue;
      const blob = await resp.blob();
      if (blob.size === 0 || blob.size > 200 * 1024 * 1024) continue;
      rec.blob = blob; // url kept as fallback until the cloud copy goes away
      const db2 = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db2.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(rec);
        tx.oncomplete = () => { db2.close(); resolve(); };
        tx.onerror = () => { db2.close(); reject(tx.error); };
      });
      migrated++;
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      // offline / transient — retry next session
    }
  }
  if (migrated > 0) console.log(`[storage] re-persisted ${migrated} remote media item(s) locally`);
  return migrated;
}

/**
 * Delete a single result by ID.
 */
export async function deleteStoredResult(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Clear all stored results.
 */
export async function clearStoredResults(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Get a single result's blob as a data URL (for download / sharing).
 * Returns the original data URL for images, or the external URL for videos.
 */
export async function getResultDataUrl(id: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = async () => {
      db.close();
      const rec: StoredResult | undefined = request.result;
      if (!rec) { resolve(null); return; }
      if (rec.blob && rec.blob instanceof Blob && rec.blob.size > 0) {
        resolve(await blobToDataUrl(rec.blob));
      } else {
        resolve(rec.url);
      }
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/**
 * Move a result to a different folder (or null for unfiled).
 */
export async function moveResultToFolder(resultId: string, folderId: string | null): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(resultId);

    getReq.onsuccess = () => {
      const rec: StoredResult | undefined = getReq.result;
      if (rec) {
        rec.folderId = folderId;
        store.put(rec);
      }
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Move multiple results to a folder in a single transaction.
 */
export async function moveResultsToFolder(ids: string[], folderId: string | null): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec: StoredResult | undefined = getReq.result;
        if (rec) {
          rec.folderId = folderId;
          store.put(rec);
        }
      };
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Permanently delete multiple results in a single transaction.
 */
export async function deleteStoredResults(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Permanently delete all results in the trash folder.
 * Returns both the deleted record ids and the external URLs that were stored
 * (so callers can ask the backend to purge any blob/R2 objects we own).
 */
export async function emptyTrash(): Promise<{ deletedIds: string[]; urls: string[] }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index("folderId");
    const req = idx.getAll(TRASH_FOLDER_ID);
    const deletedIds: string[] = [];
    const urls: string[] = [];
    req.onsuccess = () => {
      const recs: StoredResult[] = req.result || [];
      for (const rec of recs) {
        deletedIds.push(rec.id);
        if (rec.url && /^https?:\/\//i.test(rec.url)) urls.push(rec.url);
        store.delete(rec.id);
      }
    };
    tx.oncomplete = () => { db.close(); resolve({ deletedIds, urls }); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ── Folders API ──────────────────────────────────────────────────────────

/**
 * Load all folders, sorted by order.
 */
export async function loadFolders(): Promise<Folder[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, "readonly");
    const store = tx.objectStore(FOLDERS_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      const folders: Folder[] = request.result;
      folders.sort((a, b) => a.order - b.order);
      resolve(folders);
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/**
 * Create a new folder. Returns the created folder.
 */
export async function createFolder(name: string): Promise<Folder> {
  const db = await openDB();
  // Get current max order
  const folders = await new Promise<Folder[]>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, "readonly");
    const req = tx.objectStore(FOLDERS_STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const maxOrder = folders.reduce((max, f) => Math.max(max, f.order), 0);
  const folder: Folder = {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: Date.now(),
    order: maxOrder + 1,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, "readwrite");
    tx.objectStore(FOLDERS_STORE_NAME).put(folder);
    tx.oncomplete = () => { db.close(); resolve(folder); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Rename a folder.
 */
export async function renameFolder(id: string, name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, "readwrite");
    const store = tx.objectStore(FOLDERS_STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const folder: Folder | undefined = getReq.result;
      if (folder) {
        folder.name = name;
        store.put(folder);
      }
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Toggle folder visibility. Hidden folders are excluded from the main bar.
 */
export async function setFolderHidden(id: string, hidden: boolean): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, "readwrite");
    const store = tx.objectStore(FOLDERS_STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const folder: Folder | undefined = getReq.result;
      if (folder) {
        folder.hidden = hidden;
        store.put(folder);
      }
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Delete a folder. Results in this folder are moved to unfiled (folderId = null).
 */
export async function deleteFolder(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([FOLDERS_STORE_NAME, STORE_NAME], "readwrite");

    // Delete the folder
    tx.objectStore(FOLDERS_STORE_NAME).delete(id);

    // Move all results in this folder to unfiled
    const resultsStore = tx.objectStore(STORE_NAME);
    const index = resultsStore.index("folderId");
    const cursorReq = index.openCursor(IDBKeyRange.only(id));

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const rec = cursor.value as StoredResult;
        rec.folderId = null;
        cursor.update(rec);
        cursor.continue();
      }
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Reorder folders by providing an array of folder IDs in the desired order.
 */
export async function reorderFolders(orderedIds: string[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, "readwrite");
    const store = tx.objectStore(FOLDERS_STORE_NAME);

    orderedIds.forEach((id, index) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const folder: Folder | undefined = getReq.result;
        if (folder) {
          folder.order = index;
          store.put(folder);
        }
      };
    });

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ── Migration ────────────────────────────────────────────────────────────

/**
 * One-time migration: move legacy localStorage results into IndexedDB,
 * then clear the old key.
 */
export async function migrateFromLocalStorage(): Promise<GrokResult[]> {
  try {
    const raw = localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return [];

    const oldResults: GrokResult[] = JSON.parse(raw);
    if (!Array.isArray(oldResults) || oldResults.length === 0) return [];

    await saveResults(oldResults);
    localStorage.removeItem(OLD_STORAGE_KEY);
    return oldResults;
  } catch {
    return [];
  }
}

// ── Chat Messages (AI Companion) ─────────────────────────────────────────

export interface ChatMessage {
  id?: number;
  characterId: string;
  role: "user" | "assistant";
  content: string;
  mediaUrl?: string;
  mediaType?: "image" | "video";
  imageBase64?: string;
  timestamp: number;
}

export async function saveChatMessage(msg: ChatMessage): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAT_STORE_NAME, "readwrite");
    tx.objectStore(CHAT_STORE_NAME).add(msg);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getChatHistory(characterId: string, limit = 100): Promise<ChatMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAT_STORE_NAME, "readonly");
    const idx = tx.objectStore(CHAT_STORE_NAME).index("characterId");
    const request = idx.getAll(characterId);
    request.onsuccess = () => {
      db.close();
      const all = request.result as ChatMessage[];
      all.sort((a, b) => a.timestamp - b.timestamp);
      resolve(all.slice(-limit));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function clearChatHistory(characterId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAT_STORE_NAME, "readwrite");
    const store = tx.objectStore(CHAT_STORE_NAME);
    const idx = store.index("characterId");
    const request = idx.openCursor(characterId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function deleteChatMessage(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAT_STORE_NAME, "readwrite");
    tx.objectStore(CHAT_STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ── Library Export (ZIP) ─────────────────────────────────────────────────

/**
 * Export the entire library (or a filtered set of results) as a .zip file.
 * Images stored as blobs are included directly; external URLs (videos) are
 * fetched via the download proxy to avoid CORS issues.
 *
 * Files are organized into folders matching the user's folder structure.
 * A manifest.json is included with prompts and metadata.
 */
export async function exportLibraryAsZip(
  /** Results to include (already filtered by the caller). */
  results: GrokResult[],
  /** Folder map: id → name. Used to create subdirectories. */
  folderMap: Record<string, string>,
  /** Optional progress callback: (completed, total) */
  onProgress?: (completed: number, total: number) => void,
): Promise<{ included: number; skipped: number }> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // Build folder name lookup (sanitised for filesystem)
  const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, "_").trim() || "unnamed";
  const folderNames: Record<string, string> = {};
  for (const [id, name] of Object.entries(folderMap)) {
    folderNames[id] = sanitize(name);
  }

  // Read all raw records from IDB so we can access blobs directly
  const db = await openDB();
  const allRecords = await new Promise<StoredResult[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });

  const recordMap = new Map<string, StoredResult>();
  for (const rec of allRecords) recordMap.set(rec.id, rec);

  // Manifest entries
  const manifest: { filename: string; type: string; prompt?: string; folder?: string; timestamp: number }[] = [];

  const total = results.length;
  let completed = 0;
  let included = 0;
  let skipped = 0;

  // Helper to fetch a single result's blob, trying multiple sources
  async function fetchBlobForResult(result: GrokResult, rec: StoredResult | undefined, filename: string): Promise<Blob | null> {
    // 1. IndexedDB blob (best — already local, no network needed)
    if (rec?.blob && rec.blob instanceof Blob && rec.blob.size > 0) {
      return rec.blob;
    }
    // 2. Data URL embedded in result
    if (result.url.startsWith("data:")) {
      return dataUrlToBlob(result.url);
    }
    // 3. blob: URL (in-memory object URL)
    if (result.url.startsWith("blob:")) {
      try {
        const res = await fetch(result.url);
        if (res.ok) {
          const b = await res.blob();
          if (b.size > 0) return b;
        }
      } catch { /* revoked — fall through */ }
      // Fallback to the raw stored URL in IDB
      if (rec?.url && !rec.url.startsWith("blob:")) {
        try {
          const res = await fetch(rec.url);
          if (res.ok) {
            const b = await res.blob();
            if (b.size > 0) return b;
          }
        } catch { /* CORS — try proxy */ }
        try {
          const res = await fetch(getExportProxyUrl(rec.url, filename));
          if (res.ok) {
            const b = await res.blob();
            if (b.size > 0) return b;
          }
        } catch { /* skip */ }
      }
      return null;
    }
    // 4. External URL — proxy first, then direct fallback
    if (result.url) {
      try {
        const res = await fetch(getExportProxyUrl(result.url, filename));
        if (res.ok) {
          const b = await res.blob();
          if (b.size > 0) return b;
        }
      } catch { /* try direct */ }
      try {
        const res = await fetch(result.url);
        if (res.ok) {
          const b = await res.blob();
          if (b.size > 0) return b;
        }
      } catch { /* skip */ }
    }
    return null;
  }

  // Process in batches to avoid exhausting browser fetch pool / memory
  // Images are fetched in larger batches; videos (larger files) in smaller ones
  const BATCH_SIZE = 4;
  const BATCH_DELAY_MS = 120; // breathing room between batches

  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);

    // Fetch all items in the batch concurrently
    await Promise.all(batch.map(async (result) => {
      const rec = recordMap.get(result.id);
      const ext = result.type === "image" ? "png" : "mp4";
      const prefix = result.type === "image" ? "img" : "vid";
      const filename = `${prefix}_${result.id.slice(0, 8)}.${ext}`;
      const folderName = result.folderId && folderNames[result.folderId]
        ? folderNames[result.folderId]
        : "unfiled";
      const path = `${folderName}/${filename}`;

      manifest.push({
        filename: path,
        type: result.type,
        prompt: result.revised_prompt || undefined,
        folder: folderName,
        timestamp: result.timestamp,
      });

      try {
        const blob = await fetchBlobForResult(result, rec, filename);
        if (blob && blob.size > 0) {
          // Videos are already compressed — STORE avoids wasted CPU & memory
          const compression = result.type === "video" ? "STORE" : "DEFLATE";
          zip.file(path, blob, { compression, compressionOptions: { level: 4 } });
          included++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }

      completed++;
      onProgress?.(completed, total);
    }));

    // Small pause between batches so the browser can breathe
    if (i + BATCH_SIZE < results.length) {
      await new Promise<void>((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Add manifest
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // Generate ZIP blob
  const content = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } },
    () => onProgress?.(Math.min(completed, total), total),
  );

  const zipFilename = `gltch-library-${new Date().toISOString().slice(0, 10)}.zip`;
  const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia("(max-width: 768px)").matches;

  // On mobile / PWA: share the ZIP file if the browser supports it
  if (isMobileDevice && typeof navigator.share === "function") {
    try {
      const zipFile = new File([content], zipFilename, { type: "application/zip" });
      if (navigator.canShare?.({ files: [zipFile] })) {
        await navigator.share({ files: [zipFile], title: "GLTCH_RUNNER Library Export" });
        return { included, skipped };
      }
    } catch (err: any) {
      // AbortError = user cancelled share sheet — treat as success (no error toast)
      if (err?.name === "AbortError") return { included, skipped };
      // Other errors fall through to anchor download
    }
  }

  // Desktop fallback: anchor click download
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  return { included, skipped };
}

/** Build a proxy URL for exporting external media (same pattern as ResultsGrid). */
function getExportProxyUrl(url: string, filename: string): string {
  return `${apiUrl("/download")}?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
}

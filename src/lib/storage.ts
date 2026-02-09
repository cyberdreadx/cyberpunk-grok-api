/**
 * IndexedDB storage layer for Grok results.
 *
 * Replaces localStorage which was limited to ~5-10 MB (a few base64 images).
 * IndexedDB supports hundreds of MB and stores binary blobs natively.
 *
 * Schema:
 *   Database: "grok-media-db" v1
 *   Object store: "results"
 *     key: id (string)
 *     value: { id, type, revised_prompt, timestamp, blob }
 *
 * Images are stored as Blobs (not base64 strings), saving ~33% memory.
 * On read, blobs are surfaced as object URLs via URL.createObjectURL().
 */

import type { GrokResult } from "@/hooks/useGrokApi";

const DB_NAME = "grok-media-db";
const DB_VERSION = 1;
const STORE_NAME = "results";
const OLD_STORAGE_KEY = "grok-results";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Open (or create) the IndexedDB database. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
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

// ── Public API ───────────────────────────────────────────────────────────

export interface StoredResult {
  id: string;
  type: "image" | "video";
  revised_prompt?: string;
  timestamp: number;
  blob: Blob | null; // null for video (external URL kept as-is)
  url: string; // original URL for videos, empty string for images (rebuilt via objectURL)
}

/**
 * Save a single GrokResult into IndexedDB.
 * Images (data URLs) are converted to Blobs for efficient storage.
 * Videos keep their original URL since they're served externally.
 */
export async function saveResult(result: GrokResult): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const record: StoredResult = {
      id: result.id,
      type: result.type,
      revised_prompt: result.revised_prompt,
      timestamp: result.timestamp,
      blob: null,
      url: "",
    };

    if (result.type === "image" && result.url.startsWith("data:")) {
      // Convert base64 data URL to a Blob for compact storage
      record.blob = dataUrlToBlob(result.url);
      record.url = "";
    } else {
      // Video URLs or external image URLs — store the URL string directly
      record.url = result.url;
    }

    store.put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Save multiple GrokResults at once (single transaction).
 */
export async function saveResults(results: GrokResult[]): Promise<void> {
  if (results.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const result of results) {
      const record: StoredResult = {
        id: result.id,
        type: result.type,
        revised_prompt: result.revised_prompt,
        timestamp: result.timestamp,
        blob: null,
        url: "",
      };

      if (result.type === "image" && result.url.startsWith("data:")) {
        record.blob = dataUrlToBlob(result.url);
        record.url = "";
      } else {
        record.url = result.url;
      }

      store.put(record);
    }

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

/**
 * Tracks share IDs created from Library results so we can purge the underlying
 * Vercel Blob (and metadata JSON) when the user deletes the result locally.
 *
 * Stored in localStorage as a single JSON map: { [resultId]: shareId }.
 * Best-effort only — never throws.
 */
import { apiUrl } from "@/lib/api";

const STORAGE_KEY = "library-share-map";

type ShareMap = Record<string, string>;

function readMap(): ShareMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: ShareMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* quota — ignore */ }
}

/** Record that a result has an associated share. */
export function rememberShare(resultId: string, shareId: string) {
  if (!resultId || !shareId) return;
  const map = readMap();
  map[resultId] = shareId;
  writeMap(map);
}

/** Look up the share ID for a result, if any. */
export function getShareIdForResult(resultId: string): string | null {
  return readMap()[resultId] || null;
}

/** Forget the share association (without deleting from server). */
export function forgetShare(resultId: string) {
  const map = readMap();
  if (map[resultId]) {
    delete map[resultId];
    writeMap(map);
  }
}

/**
 * Best-effort: ask the server to purge the underlying Vercel Blob + metadata
 * for any share IDs associated with the given result IDs, then forget them
 * locally. Failures are logged and swallowed — local deletion must always win.
 */
export async function purgeSharesForResults(resultIds: string[]): Promise<void> {
  if (resultIds.length === 0) return;
  const map = readMap();
  const token = localStorage.getItem("auth-token");
  if (!token) {
    // No auth → can't authorize the DELETE. Just forget locally.
    for (const id of resultIds) delete map[id];
    writeMap(map);
    return;
  }

  await Promise.all(
    resultIds.map(async (resultId) => {
      const shareId = map[resultId];
      if (!shareId) return;
      try {
        await fetch(`${apiUrl("/share")}?id=${encodeURIComponent(shareId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        console.warn("[share-tracker] purge failed for", shareId, e);
      } finally {
        delete map[resultId];
      }
    }),
  );

  writeMap(map);
}

/** Clear and purge ALL tracked shares (used by "clear library"). */
export async function purgeAllTrackedShares(): Promise<void> {
  const ids = Object.keys(readMap());
  if (ids.length === 0) return;
  await purgeSharesForResults(ids);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

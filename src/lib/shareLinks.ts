/**
 * Share-link map — persists resultId → /s/:id share info in localStorage so
 * deleting a result can also tear down its public share (the privacy-policy
 * promise). The server's share_owners table remains the source of truth;
 * this map only lets the *local* delete flow know which share to revoke.
 */
import { apiUrl } from "@/lib/api";

const STORAGE_KEY = "share-link-map";

type ShareLinkMap = Record<string, { shareId: string; shareUrl: string }>;

function readMap(): ShareLinkMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as ShareLinkMap;
  } catch {
    return {};
  }
}

function writeMap(map: ShareLinkMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota — non-fatal */
  }
}

/** `https://…/s/AbC123` → `AbC123` */
function shareIdFromUrl(shareUrl: string): string | null {
  const m = shareUrl.match(/\/s\/([a-zA-Z0-9_-]{4,16})/);
  return m ? m[1] : null;
}

export function recordShareLink(resultId: string, shareUrl: string): void {
  const shareId = shareIdFromUrl(shareUrl);
  if (!shareId) return;
  const map = readMap();
  map[resultId] = { shareId, shareUrl };
  writeMap(map);
}

export function getShareLink(resultId: string): { shareId: string; shareUrl: string } | null {
  return readMap()[resultId] || null;
}

/**
 * Best-effort teardown of the shares behind permanently-deleted results.
 * Never throws — local deletion must not be blocked by network failures.
 */
export async function revokeSharesForResults(resultIds: string[]): Promise<void> {
  const map = readMap();
  const targets = resultIds.filter((id) => map[id]);
  if (targets.length === 0) return;

  const token = localStorage.getItem("auth-token");
  await Promise.all(
    targets.map(async (resultId) => {
      const { shareId } = map[resultId];
      try {
        const res = await fetch(apiUrl(`/share?id=${encodeURIComponent(shareId)}`), {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        // 403/404 = not ours / already gone — still drop the stale mapping
        if (res.ok || res.status === 403 || res.status === 404) delete map[resultId];
      } catch (err: any) {
        console.warn("[shareLinks] revoke failed:", shareId, err?.message);
      }
    }),
  );
  writeMap(map);
}

/** Drop mappings without touching the server (e.g. after a server-side bulk revoke). */
export function forgetShareLinks(resultIds?: string[]): void {
  if (!resultIds) {
    writeMap({});
    return;
  }
  const map = readMap();
  for (const id of resultIds) delete map[id];
  writeMap(map);
}

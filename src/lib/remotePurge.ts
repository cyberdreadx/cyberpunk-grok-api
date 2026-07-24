/**
 * Best-effort backend purge of the blob/R2 objects behind deleted library
 * items. Every PERMANENT deletion path must call this — the server only
 * deletes objects it can prove the caller owns (or unreferenced legacy
 * keys), so it's safe to fire liberally. Never throws.
 */
export async function purgeRemoteUrls(urls: string[]): Promise<void> {
  if (!urls.length) return;
  try {
    const { apiFetch } = await import("@/lib/api");
    await apiFetch("/library-purge", { method: "POST", body: { urls } });
  } catch (err: any) {
    console.warn("[remotePurge] backend purge failed:", err?.message || err);
  }
}

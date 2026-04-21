/**
 * Cross-tab synchronization for the user's API-mode selection (BYOK vs.
 * credits) and BYOK key presence.
 *
 * Primary channel: BroadcastChannel — fires synchronously across tabs in
 * the same origin, with no risk of being misinterpreted as a local write.
 *
 * Fallback channel: native `storage` events. Browsers dispatch these in
 * *other* tabs automatically whenever localStorage is mutated, so we do
 * not need (and must not) manually dispatch a synthetic StorageEvent in
 * the writing tab — that was the previous hack and could double-fire
 * handlers in the same tab.
 *
 * The same-tab listeners use a lightweight in-process EventTarget so a
 * single tab's hook instances stay in sync without going through any
 * async transport.
 */

export type ApiModeMessage =
  | { kind: "api-mode"; mode: "byok" | "credits" }
  | { kind: "xai-key"; hasKey: boolean };

const CHANNEL_NAME = "gltch-api-mode";

let bc: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (bc) return bc;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    bc = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    bc = null;
  }
  return bc;
}

// Same-tab fan-out: BroadcastChannel does NOT deliver to the tab that
// posted the message, and `storage` events also only fire in other tabs.
// So for in-process consumers (multiple useGrokApi mounts) we use a tiny
// EventTarget.
const localBus =
  typeof window !== "undefined" ? new EventTarget() : null;

/**
 * Publish an apiMode change to all tabs (and any in-tab subscribers).
 * Caller is responsible for persisting to localStorage first.
 */
export function publishApiMode(msg: ApiModeMessage) {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    /* channel closed during teardown; storage event will pick up the slack */
  }
  try {
    localBus?.dispatchEvent(new CustomEvent("api-mode-msg", { detail: msg }));
  } catch {}
}

/**
 * Subscribe to apiMode messages. Returns an unsubscribe function.
 *
 * The handler will be called for:
 *   - BroadcastChannel messages from other tabs
 *   - in-tab `publishApiMode` calls from sibling components
 *   - native `storage` events (fallback for browsers/contexts where
 *     BroadcastChannel is unavailable, e.g. some private modes)
 */
export function subscribeApiMode(
  handler: (msg: ApiModeMessage) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const ch = getChannel();
  const onChannel = (e: MessageEvent) => {
    const data = e?.data as ApiModeMessage | undefined;
    if (!data || typeof data.kind !== "string") return;
    handler(data);
  };
  const onLocal = (e: Event) => {
    const detail = (e as CustomEvent).detail as ApiModeMessage | undefined;
    if (detail) handler(detail);
  };
  const onStorage = (e: StorageEvent) => {
    // Browser dispatched in *other* tabs only — safe to translate.
    if (e.key === "api-mode" && (e.newValue === "byok" || e.newValue === "credits")) {
      handler({ kind: "api-mode", mode: e.newValue });
    } else if (e.key === "xai-api-key") {
      handler({ kind: "xai-key", hasKey: !!e.newValue });
    } else if (e.key === null) {
      // Storage was cleared in another tab.
      handler({ kind: "xai-key", hasKey: false });
    }
  };

  ch?.addEventListener("message", onChannel);
  localBus?.addEventListener("api-mode-msg", onLocal);
  window.addEventListener("storage", onStorage);

  return () => {
    ch?.removeEventListener("message", onChannel);
    localBus?.removeEventListener("api-mode-msg", onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Bridge to the GLTCH Studio iPhone app (gltch-studio-app, an Expo shell that
 * shows this site in a WebView).
 *
 * Inside the app, a browser download goes nowhere — WKWebView has no downloads
 * folder — so saving hands the file to the app, which writes it to Photos. The
 * app answers on the "gltch-native" window event with the same id.
 *
 * Outside the app none of this runs: isNativeApp is false and callers keep
 * their normal web path.
 */

interface NativeBridge {
  postMessage: (message: string) => void;
}

type NativeReply = { id: string; ok: boolean; error?: string };

const bridge = (): NativeBridge | null =>
  typeof window !== "undefined"
    ? ((window as unknown as { ReactNativeWebView?: NativeBridge }).ReactNativeWebView ?? null)
    : null;

/** True when this page is running inside the GLTCH Studio app. */
export const isNativeApp = (): boolean => bridge() !== null;

let seq = 0;

function request(message: Record<string, unknown>, timeoutMs = 120_000): Promise<NativeReply> {
  const b = bridge();
  if (!b) return Promise.resolve({ id: "", ok: false, error: "not in app" });
  const id = `n${Date.now()}-${++seq}`;
  return new Promise((resolve) => {
    const done = (reply: NativeReply) => {
      window.removeEventListener("gltch-native", onReply);
      clearTimeout(timer);
      resolve(reply);
    };
    const onReply = (e: Event) => {
      const detail = (e as CustomEvent<NativeReply>).detail;
      if (detail?.id === id) done(detail);
    };
    const timer = setTimeout(() => done({ id, ok: false, error: "timeout" }), timeoutMs);
    window.addEventListener("gltch-native", onReply);
    b.postMessage(JSON.stringify({ ...message, id }));
  });
}

async function blobToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Save an image or video to the phone's Photos. Remote URLs are downloaded by
 * the app; blob: URLs only exist in this page, so they travel as data URLs.
 */
export async function nativeSaveMedia(url: string, type: "image" | "video"): Promise<NativeReply> {
  const payload = url.startsWith("blob:") ? await blobToDataUrl(url) : new URL(url, window.location.href).href;
  return request({ type: "save-media", url: payload, kind: type });
}

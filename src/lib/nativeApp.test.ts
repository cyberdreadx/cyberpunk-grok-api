/**
 * The handoff between this site and the GLTCH Studio iPhone app. If it breaks,
 * Download does nothing inside the app, with no error anywhere.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativeApp, nativeSaveMedia } from "./nativeApp";

type Win = Window & { ReactNativeWebView?: { postMessage: (m: string) => void } };

/** Stand-in for the app: records what the page sends and answers like App.tsx. */
function fakeApp(answer: (msg: Record<string, unknown>) => Record<string, unknown> | null) {
  const sent: Record<string, unknown>[] = [];
  (window as Win).ReactNativeWebView = {
    postMessage: (raw) => {
      const msg = JSON.parse(raw);
      sent.push(msg);
      const reply = answer(msg);
      if (reply) setTimeout(() => window.dispatchEvent(new CustomEvent("gltch-native", { detail: { ...reply, id: msg.id } })), 0);
    },
  };
  return sent;
}

afterEach(() => {
  delete (window as Win).ReactNativeWebView;
  vi.useRealTimers();
});

describe("nativeApp bridge", () => {
  it("is off in a normal browser", async () => {
    expect(isNativeApp()).toBe(false);
    expect((await nativeSaveMedia("https://cdn.example/a.png", "image")).ok).toBe(false);
  });

  it("sends an absolute URL and resolves with the app's answer", async () => {
    const sent = fakeApp(() => ({ ok: true }));
    expect(isNativeApp()).toBe(true);
    const r = await nativeSaveMedia("/media/clip.mp4", "video");
    expect(r.ok).toBe(true);
    expect(sent[0]).toMatchObject({ type: "save-media", kind: "video", url: `${window.location.origin}/media/clip.mp4` });
  });

  it("matches answers to requests, so two saves at once each get their own", async () => {
    fakeApp((m) => ({ ok: String(m.url).endsWith("good.png") }));
    const [a, b] = await Promise.all([
      nativeSaveMedia("https://cdn.example/good.png", "image"),
      nativeSaveMedia("https://cdn.example/bad.png", "image"),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });

  it("passes the app's error through (e.g. Photos access denied)", async () => {
    fakeApp(() => ({ ok: false, error: "permission" }));
    expect(await nativeSaveMedia("https://cdn.example/a.png", "image")).toMatchObject({ ok: false, error: "permission" });
  });

  it("gives up rather than hanging if the app never answers", async () => {
    vi.useFakeTimers();
    fakeApp(() => null);
    const p = nativeSaveMedia("https://cdn.example/a.png", "image");
    await vi.advanceTimersByTimeAsync(121_000);
    expect(await p).toMatchObject({ ok: false, error: "timeout" });
  });
});

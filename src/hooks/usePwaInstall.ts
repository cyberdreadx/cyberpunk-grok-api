import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";
const VISIT_COUNT_KEY = "pwa-install-visits";
const MIN_VISITS_BEFORE_PROMPT = 2;
const DISMISSED_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [enoughVisits, setEnoughVisits] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const mobile = /iPhone|iPad|iPod|Android/i.test(ua);
    const ios = /iPhone|iPad|iPod/i.test(ua) && !(window as any).MSStream;
    setIsMobile(mobile);
    setIsIos(ios);

    // Already running as installed PWA
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    setIsInstalled(standalone);

    // Check if user dismissed recently
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) {
        const ts = parseInt(raw, 10);
        if (Date.now() - ts < DISMISSED_DURATION_MS) setDismissed(true);
      }
    } catch { /* ignore */ }

    // Visit counter — only prompt after the user has come back at least once
    try {
      const raw = localStorage.getItem(VISIT_COUNT_KEY);
      const next = (raw ? parseInt(raw, 10) || 0 : 0) + 1;
      localStorage.setItem(VISIT_COUNT_KEY, String(next));
      if (next >= MIN_VISITS_BEFORE_PROMPT) setEnoughVisits(true);
    } catch { /* ignore */ }

    // Chrome/Edge/Android install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => setIsInstalled(true);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const install = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setIsInstalled(true);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, Date.now().toString()); } catch { /* quota */ }
  }, []);

  const canPrompt = deferredPrompt !== null;
  const shouldShow = isMobile && !isInstalled && !dismissed && enoughVisits;

  return { canPrompt, isIos, isMobile, isInstalled, shouldShow, install, dismiss };
}

import { useEffect, useState, useCallback } from "react";

/**
 * Mature-content filter preference.
 *
 * Default policy:
 * - Logged-OUT visitors: filter ON (blur all media flagged mature, plus all media as a teaser).
 * - Logged-IN users: filter ON for posts the creator marked `isMature` (toggleable in Settings).
 *
 * Stored in localStorage as `gltch-mature-filter` (`"on" | "off"`).
 * Components subscribe via `useMatureFilter()` and react to the
 * `mature-filter-change` window event.
 */
const STORAGE_KEY = "gltch-mature-filter";
const EVENT = "mature-filter-change";

const readPref = (): boolean => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "off") return false;
    return true; // default ON
  } catch {
    return true;
  }
};

export function useMatureFilter() {
  const [enabled, setEnabled] = useState<boolean>(() => readPref());

  useEffect(() => {
    const onChange = () => setEnabled(readPref());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setMatureFilter = useCallback((next: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {}
    setEnabled(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { matureFilter: enabled, setMatureFilter };
}

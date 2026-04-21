/**
 * useCreditsView — small global preference for how the credits pill
 * displays the user's balance. Does NOT change generation mode; this is
 * purely a display toggle.
 *
 * - "credits": show coin + numeric balance (default)
 * - "byok":    show "BYOK" emphasis when a personal API key is set,
 *              numeric balance becomes secondary
 */
import { useEffect, useState, useCallback } from "react";

export type CreditsView = "credits" | "byok";

const KEY = "credits-view-pref";
const EVENT = "credits-view-change";

const read = (): CreditsView => {
  if (typeof localStorage === "undefined") return "credits";
  return (localStorage.getItem(KEY) as CreditsView) || "credits";
};

export function useCreditsView() {
  const [view, setViewState] = useState<CreditsView>(read);

  useEffect(() => {
    const sync = () => setViewState(read());
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  const setView = useCallback((next: CreditsView) => {
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event(EVENT));
    setViewState(next);
  }, []);

  const toggle = useCallback(() => {
    setView(view === "credits" ? "byok" : "credits");
  }, [view, setView]);

  return { view, setView, toggle };
}

/**
 * Page memory between the main tabs.
 *
 * Switching between Feed, Create and Library used to throw the page away and
 * build it again: scroll went back to the top, the feed re-fetched from page
 * one, a half-written prompt and an uploaded image vanished, and a generation
 * in progress lost its on-screen progress until the resume logic found it.
 *
 * These pages are now built on first visit and then only hidden when you leave,
 * never unmounted, so every piece of their state survives — including timers,
 * so a generation keeps updating while you browse the feed. Each tab also keeps
 * its own scroll position, which a shared window scroll would otherwise lose.
 *
 * Paths kept here must still have a <Route element={null}> in App.tsx, so the
 * router knows they exist and the "*" catch-all does not fire for them.
 *
 * Pages kept alive must not assume they mount on every visit. Anything that
 * reads the URL (deep links, ?post=, ?store=1) has to react to navigation, and
 * only act while its page is the active one. Anything they portal into <body>
 * escapes display:none and must check useTabActive().
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { TabActiveContext } from "@/hooks/useTabActive";

export interface KeptTab {
  path: string;
  element: React.ReactNode;
}

export default function KeepAliveTabs({ tabs }: { tabs: KeptTab[] }) {
  const { pathname } = useLocation();
  const active = tabs.find((t) => t.path === pathname)?.path ?? null;

  // Tabs are built the first time they are visited, not all at boot: someone
  // who never opens Library should not pay for it.
  const [visited, setVisited] = useState<string[]>(() => (active ? [active] : []));
  useEffect(() => {
    if (active && !visited.includes(active)) setVisited((v) => [...v, active]);
  }, [active, visited]);

  // Per-tab scroll. The window scroll is shared, so it is recorded continuously
  // for whichever tab is showing and put back when that tab returns.
  const scrollByTab = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!active) return;
    const onScroll = () => { scrollByTab.current[active] = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [active]);

  const containers = useRef<Record<string, HTMLDivElement | null>>({});
  const previous = useRef<string | null>(active);
  useLayoutEffect(() => {
    const left = previous.current;
    previous.current = active;
    if (left === active) return;

    // Nothing should keep playing in a tab you can no longer see.
    if (left) {
      containers.current[left]?.querySelectorAll("video, audio").forEach((m) => {
        try { (m as HTMLMediaElement).pause(); } catch { /* detached */ }
      });
    }

    if (!active) return;
    const y = scrollByTab.current[active] ?? 0;
    window.scrollTo(0, y);
    // Content may still be laying out (images, lazy chunks): try once more on
    // the next frame so a long feed lands where it was left rather than short.
    requestAnimationFrame(() => {
      if (previous.current === active && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    });
  }, [active]);

  return (
    <>
      {tabs
        .filter((t) => visited.includes(t.path))
        .map((t) => (
          <div
            key={t.path}
            ref={(el) => { containers.current[t.path] = el; }}
            // display:none rather than unmounting: the tab, its state and its
            // timers all stay alive. Fixed-position chrome inside a hidden tab
            // (its own header and bottom nav) is not rendered either.
            style={t.path === active ? undefined : { display: "none" }}
            aria-hidden={t.path === active ? undefined : true}
          >
            <TabActiveContext.Provider value={t.path === active}>{t.element}</TabActiveContext.Provider>
          </div>
        ))}
    </>
  );
}

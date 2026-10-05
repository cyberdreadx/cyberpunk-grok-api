import { createContext, useContext } from "react";

/**
 * Whether the kept-alive tab this component lives in is the one showing.
 *
 * A hidden tab is display:none, which hides everything inside it — except
 * portals, which render into <body> and escape it. Anything portaled that is
 * always on (bottom nav, credits pill, the sticky Generate button) must check
 * this, or every visited tab's copy shows at once. Outside KeepAliveTabs it is
 * always true.
 */
export const TabActiveContext = createContext(true);

export const useTabActive = () => useContext(TabActiveContext);

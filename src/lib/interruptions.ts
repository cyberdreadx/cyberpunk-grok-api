/**
 * One unprompted popup per visit.
 *
 * A brand-new signed-in user used to meet, in a single sitting: the age gate,
 * a 9-step guide modal, the full changelog (for versions they had never used),
 * a "Welcome to the Feed" modal, and a 4-step tooltip tour inside the
 * generator. Each was reasonable alone; together they stood between a person
 * and the thing they came to do.
 *
 * Anything that opens itself without being asked claims the visit here first.
 * Whatever claims it shows; anything later waits for a future visit. "Visit" is
 * a browser tab session — sessionStorage survives reloads within a tab and
 * resets in a new one — so a reload does not reopen the budget.
 *
 * Popups a user explicitly opens (help menu, "What's new") never go through
 * this: the budget is only for interruptions.
 */

const KEY = "gltch-interrupted-this-visit";

export function hasInterruptedThisVisit(): boolean {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Record that something has already interrupted this visit. */
export function markInterrupted(): void {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked */ }
}

/** Claim the visit if nothing has yet. True means "you may show yourself". */
export function claimInterruption(): boolean {
  if (hasInterruptedThisVisit()) return false;
  markInterrupted();
  return true;
}

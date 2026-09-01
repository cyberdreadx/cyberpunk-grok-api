/**
 * Easy / Classic mode for the create screen.
 *
 * Classic is the existing prompt + parameters + generate flow, unchanged.
 * Easy is a chat thread over the same generate APIs. Nobody is moved between
 * them without asking.
 *
 * Defaults, in priority order:
 *   1. ?mode=easy|classic          — explicit, wins over everything
 *   2. a Classic deep link          — ?action=edit|animate or ?prompt= come
 *                                     from the Library and old bookmarks and
 *                                     land on the parameter UI they expect
 *   3. the stored preference        — whatever the user last chose
 *   4. Classic                      — the safe default for every account that
 *                                     existed before Easy shipped
 *
 * "New accounts default to Easy" is implemented by writing the preference at
 * signup rather than by comparing dates: an account with no stored preference
 * is by definition one that predates this, and gets Classic.
 */

export type CreateMode = "easy" | "classic";

const KEY = "create-mode";

/** Classic deep links: the Library's edit/animate handoff and shared prompts. */
function isClassicDeepLink(search: string): boolean {
  const p = new URLSearchParams(search);
  const action = p.get("action");
  return action === "edit" || action === "animate" || !!p.get("prompt");
}

function read(): CreateMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "easy" || v === "classic" ? v : null;
  } catch {
    return null;
  }
}

export function setCreateMode(mode: CreateMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch { /* private mode — the session still works, it just won't persist */ }
}

/** Called once on signup so brand-new accounts land in Easy. */
export function setCreateModeDefaultForNewAccount(): void {
  if (read() === null) setCreateMode("easy");
}

export function resolveCreateMode(search = typeof window !== "undefined" ? window.location.search : ""): CreateMode {
  const explicit = new URLSearchParams(search).get("mode");
  if (explicit === "easy" || explicit === "classic") return explicit;
  if (isClassicDeepLink(search)) return "classic";
  return read() ?? "classic";
}

/** Whether the DeepSeek prompt assist is on. Off by default — it costs 1 credit
 *  per message and a chat box should not spend credits nobody asked it to. */
const ASSIST_KEY = "create-easy-assist";

export function getAssist(): boolean {
  try {
    return localStorage.getItem(ASSIST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAssist(on: boolean): void {
  try {
    localStorage.setItem(ASSIST_KEY, on ? "1" : "0");
  } catch { /* non-fatal */ }
}

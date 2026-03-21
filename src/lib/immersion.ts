import { apiFetch } from "@/lib/api";

export interface ImmersionSettings {
  flicker: number;
  pulseHz: number;
  redShift: number;
  glow: number;
  scanline: number;
  vignette: number;
}

/** Safe defaults — sliders can push higher for admin testing. */
export const DEFAULT_IMMERSION: ImmersionSettings = {
  flicker: 0.35,
  pulseHz: 0.7,
  redShift: 8,
  glow: 0.85,
  scanline: 0.16,
  vignette: 0.4,
};

function mergeImmersion(partial: Partial<ImmersionSettings> | null | undefined): ImmersionSettings {
  return { ...DEFAULT_IMMERSION, ...partial };
}

/** Master immersion from the API (same for all users). GET is public. */
export async function fetchMasterImmersion(): Promise<ImmersionSettings> {
  try {
    const data = await apiFetch<ImmersionSettings>("/immersion", { method: "GET", auth: false });
    return mergeImmersion(data);
  } catch {
    return DEFAULT_IMMERSION;
  }
}

/** Push immersion tuning to :root so CSS can read --immersion-* vars. */
export function applyImmersionToRoot(settings: ImmersionSettings): void {
  const root = document.documentElement;
  root.style.setProperty("--immersion-flicker", String(settings.flicker));
  root.style.setProperty("--immersion-pulse-hz", String(settings.pulseHz));
  root.style.setProperty("--immersion-red-shift", String(settings.redShift));
  root.style.setProperty("--immersion-glow", String(settings.glow));
  root.style.setProperty("--immersion-scanline", String(settings.scanline));
  root.style.setProperty("--immersion-vignette", String(settings.vignette));
}

/** Admin: persist master immersion for every visitor (requires JWT). */
export async function saveMasterImmersion(settings: ImmersionSettings): Promise<void> {
  await apiFetch("/immersion", { method: "POST", body: settings, auth: true });
}
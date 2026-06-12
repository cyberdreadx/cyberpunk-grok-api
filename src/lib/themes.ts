/**
 * Theme definitions for the cyberpunk UI.
 * Each theme overrides CSS custom properties on :root.
 * The active theme is persisted in localStorage.
 */

import {
  applyImmersionToRoot,
  BARE_IMMERSION,
  DEFAULT_IMMERSION,
  fetchMasterImmersion,
} from "@/lib/immersion";

export interface CyberTheme {
  id: string;
  name: string;
  label: string;
  /** Accent color shown in the theme picker swatch */
  swatch: string;
  /** CSS custom property overrides (HSL values without hsl() wrapper) */
  vars: Record<string, string>;
}

export const BARE_THEME_ID = "bare";

export function isBareThemeId(id: string): boolean {
  return id === BARE_THEME_ID;
}

export const THEMES: CyberTheme[] = [
  {
    id: "command",
    name: "COMMAND_CENTER",
    label: "Black + steel, strategic red",
    swatch: "#d2d8e0",
    vars: {
      "--background": "240 7% 3%",
      "--foreground": "220 14% 93%",
      "--card": "240 6% 6%",
      "--card-foreground": "220 14% 93%",
      "--popover": "240 7% 5%",
      "--popover-foreground": "220 14% 93%",
      "--primary": "0 72% 52%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "14 80% 55%",
      "--secondary-foreground": "240 7% 3%",
      "--muted": "240 5% 12%",
      "--muted-foreground": "220 10% 64%",
      "--accent": "240 5% 16%",
      "--accent-foreground": "220 14% 93%",
      "--border": "220 8% 18%",
      "--input": "240 5% 10%",
      "--ring": "0 72% 52%",
      "--neon-cyan": "210 18% 84%",
      "--neon-magenta": "14 80% 60%",
      "--neon-purple": "220 12% 70%",
      "--neon-yellow": "38 100% 55%",
      "--neon-red": "0 100% 55%",
      "--glow-cyan": "0 0 10px hsl(210 18% 84% / 0.35), 0 0 30px hsl(210 18% 84% / 0.12)",
      "--glow-magenta": "0 0 10px hsl(14 80% 60% / 0.4), 0 0 30px hsl(14 80% 60% / 0.15)",
      "--glow-purple": "0 0 10px hsl(220 12% 70% / 0.35), 0 0 30px hsl(220 12% 70% / 0.12)",
    },
  },
  {
    id: "neon",
    name: "NEON_CIRCUIT",
    label: "Original cyan/magenta neon",
    swatch: "#00ffff",
    vars: {
      "--background": "240 15% 5%",
      "--foreground": "180 100% 85%",
      "--card": "240 12% 8%",
      "--card-foreground": "180 100% 85%",
      "--popover": "240 15% 7%",
      "--popover-foreground": "180 100% 85%",
      "--primary": "180 100% 50%",
      "--primary-foreground": "240 15% 5%",
      "--secondary": "300 100% 60%",
      "--secondary-foreground": "240 15% 5%",
      "--muted": "240 10% 15%",
      "--muted-foreground": "180 30% 55%",
      "--accent": "270 100% 65%",
      "--accent-foreground": "0 0% 100%",
      "--border": "180 60% 20%",
      "--input": "240 12% 12%",
      "--ring": "180 100% 50%",
      "--neon-cyan": "180 100% 50%",
      "--neon-magenta": "300 100% 60%",
      "--neon-purple": "270 100% 65%",
      "--neon-yellow": "55 100% 55%",
      "--neon-red": "0 100% 55%",
      "--glow-cyan": "0 0 10px hsl(180 100% 50% / 0.5), 0 0 30px hsl(180 100% 50% / 0.2)",
      "--glow-magenta": "0 0 10px hsl(300 100% 60% / 0.5), 0 0 30px hsl(300 100% 60% / 0.2)",
      "--glow-purple": "0 0 10px hsl(270 100% 65% / 0.5), 0 0 30px hsl(270 100% 65% / 0.2)",
    },
  },
  {
    id: "matrix",
    name: "MATRIX_RAIN",
    label: "Green phosphor terminal",
    swatch: "#00ff41",
    vars: {
      "--background": "120 10% 3%",
      "--foreground": "120 100% 75%",
      "--card": "120 8% 6%",
      "--card-foreground": "120 100% 75%",
      "--popover": "120 10% 5%",
      "--popover-foreground": "120 100% 75%",
      "--primary": "120 100% 50%",
      "--primary-foreground": "120 10% 3%",
      "--secondary": "90 100% 45%",
      "--secondary-foreground": "120 10% 3%",
      "--muted": "120 8% 12%",
      "--muted-foreground": "120 40% 45%",
      "--accent": "150 100% 45%",
      "--accent-foreground": "0 0% 100%",
      "--border": "120 60% 18%",
      "--input": "120 8% 8%",
      "--ring": "120 100% 50%",
      "--neon-cyan": "120 100% 50%",
      "--neon-magenta": "90 100% 45%",
      "--neon-purple": "150 100% 45%",
      "--neon-yellow": "80 100% 50%",
      "--neon-red": "0 100% 55%",
      "--glow-cyan": "0 0 10px hsl(120 100% 50% / 0.5), 0 0 30px hsl(120 100% 50% / 0.2)",
      "--glow-magenta": "0 0 10px hsl(90 100% 45% / 0.5), 0 0 30px hsl(90 100% 45% / 0.2)",
      "--glow-purple": "0 0 10px hsl(150 100% 45% / 0.5), 0 0 30px hsl(150 100% 45% / 0.2)",
    },
  },
  {
    id: "blood",
    name: "BLOOD_CHROME",
    label: "Red and chrome noir",
    swatch: "#ff1744",
    vars: {
      "--background": "0 5% 4%",
      "--foreground": "0 20% 80%",
      "--card": "0 5% 7%",
      "--card-foreground": "0 20% 80%",
      "--popover": "0 5% 6%",
      "--popover-foreground": "0 20% 80%",
      "--primary": "0 100% 55%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "25 100% 55%",
      "--secondary-foreground": "0 5% 4%",
      "--muted": "0 5% 13%",
      "--muted-foreground": "0 15% 50%",
      "--accent": "340 100% 55%",
      "--accent-foreground": "0 0% 100%",
      "--border": "0 50% 22%",
      "--input": "0 5% 10%",
      "--ring": "0 100% 55%",
      "--neon-cyan": "0 100% 55%",
      "--neon-magenta": "340 100% 55%",
      "--neon-purple": "25 100% 55%",
      "--neon-yellow": "40 100% 55%",
      "--neon-red": "0 100% 55%",
      "--glow-cyan": "0 0 10px hsl(0 100% 55% / 0.5), 0 0 30px hsl(0 100% 55% / 0.2)",
      "--glow-magenta": "0 0 10px hsl(340 100% 55% / 0.5), 0 0 30px hsl(340 100% 55% / 0.2)",
      "--glow-purple": "0 0 10px hsl(25 100% 55% / 0.5), 0 0 30px hsl(25 100% 55% / 0.2)",
    },
  },
  {
    id: "ice",
    name: "BLACK_ICE",
    label: "Cold blue hacker aesthetic",
    swatch: "#4fc3f7",
    vars: {
      "--background": "220 20% 4%",
      "--foreground": "210 80% 80%",
      "--card": "220 15% 7%",
      "--card-foreground": "210 80% 80%",
      "--popover": "220 18% 6%",
      "--popover-foreground": "210 80% 80%",
      "--primary": "200 100% 60%",
      "--primary-foreground": "220 20% 4%",
      "--secondary": "230 80% 65%",
      "--secondary-foreground": "220 20% 4%",
      "--muted": "220 12% 14%",
      "--muted-foreground": "210 30% 50%",
      "--accent": "190 100% 50%",
      "--accent-foreground": "0 0% 100%",
      "--border": "210 50% 22%",
      "--input": "220 15% 10%",
      "--ring": "200 100% 60%",
      "--neon-cyan": "200 100% 60%",
      "--neon-magenta": "230 80% 65%",
      "--neon-purple": "190 100% 50%",
      "--neon-yellow": "55 100% 55%",
      "--neon-red": "0 100% 55%",
      "--glow-cyan": "0 0 10px hsl(200 100% 60% / 0.5), 0 0 30px hsl(200 100% 60% / 0.2)",
      "--glow-magenta": "0 0 10px hsl(230 80% 65% / 0.5), 0 0 30px hsl(230 80% 65% / 0.2)",
      "--glow-purple": "0 0 10px hsl(190 100% 50% / 0.5), 0 0 30px hsl(190 100% 50% / 0.2)",
    },
  },
  {
    id: "ghost",
    name: "GHOST_WIRE",
    label: "Purple and violet netrunner",
    swatch: "#bb86fc",
    vars: {
      "--background": "270 15% 4%",
      "--foreground": "270 60% 82%",
      "--card": "270 12% 7%",
      "--card-foreground": "270 60% 82%",
      "--popover": "270 14% 6%",
      "--popover-foreground": "270 60% 82%",
      "--primary": "270 100% 68%",
      "--primary-foreground": "270 15% 4%",
      "--secondary": "310 100% 60%",
      "--secondary-foreground": "270 15% 4%",
      "--muted": "270 10% 14%",
      "--muted-foreground": "270 25% 50%",
      "--accent": "250 100% 65%",
      "--accent-foreground": "0 0% 100%",
      "--border": "270 45% 22%",
      "--input": "270 12% 10%",
      "--ring": "270 100% 68%",
      "--neon-cyan": "270 100% 68%",
      "--neon-magenta": "310 100% 60%",
      "--neon-purple": "250 100% 65%",
      "--neon-yellow": "55 100% 55%",
      "--neon-red": "0 100% 55%",
      "--glow-cyan": "0 0 10px hsl(270 100% 68% / 0.5), 0 0 30px hsl(270 100% 68% / 0.2)",
      "--glow-magenta": "0 0 10px hsl(310 100% 60% / 0.5), 0 0 30px hsl(310 100% 60% / 0.2)",
      "--glow-purple": "0 0 10px hsl(250 100% 65% / 0.5), 0 0 30px hsl(250 100% 65% / 0.2)",
    },
  },
  {
    id: BARE_THEME_ID,
    name: "BARE_RUN",
    label: "No chrome — flat UI, minimal GPU",
    swatch: "#94a3b8",
    vars: {
      "--background": "220 14% 10%",
      "--foreground": "210 20% 92%",
      "--card": "220 12% 14%",
      "--card-foreground": "210 20% 92%",
      "--popover": "220 12% 12%",
      "--popover-foreground": "210 20% 92%",
      "--primary": "215 70% 55%",
      "--primary-foreground": "220 14% 8%",
      "--secondary": "220 10% 40%",
      "--secondary-foreground": "210 20% 96%",
      "--muted": "220 10% 20%",
      "--muted-foreground": "215 12% 55%",
      "--accent": "215 50% 45%",
      "--accent-foreground": "0 0% 100%",
      "--border": "220 10% 24%",
      "--input": "220 10% 18%",
      "--ring": "215 70% 55%",
      "--neon-cyan": "215 70% 55%",
      "--neon-magenta": "220 10% 55%",
      "--neon-purple": "215 50% 45%",
      "--neon-yellow": "45 80% 50%",
      "--neon-red": "0 70% 50%",
      "--glow-cyan": "none",
      "--glow-magenta": "none",
      "--glow-purple": "none",
    },
  },
];

const THEME_KEY = "cyber-theme";
const THEME_MIGRATED_KEY = "cyber-theme-migrated-command";

/** Apply palette + `data-cyber-theme` only (use before React paint; no network). */
export function applyThemeVisuals(theme: CyberTheme): void {
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, value);
  }
  root.dataset.cyberTheme = theme.id;
}

export function getStoredThemeId(): string {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (!stored) return "command";
    // One-time rebrand migration: "neon" was the old default and was
    // auto-persisted by the picker, so a stored "neon" usually wasn't a
    // deliberate choice. Move it to the new default once; re-selecting
    // NEON_CIRCUIT afterwards sticks because the flag is set.
    if (stored === "neon" && !localStorage.getItem(THEME_MIGRATED_KEY)) {
      localStorage.setItem(THEME_MIGRATED_KEY, "1");
      localStorage.setItem(THEME_KEY, "command");
      return "command";
    }
    return stored;
  } catch {
    return "command";
  }
}

export function getThemeById(id: string): CyberTheme {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function applyTheme(theme: CyberTheme): void {
  applyThemeVisuals(theme);
  try {
    localStorage.setItem(THEME_KEY, theme.id);
    // Explicit choice — never auto-migrate it afterwards.
    localStorage.setItem(THEME_MIGRATED_KEY, "1");
  } catch { /* quota exceeded */ }
  if (isBareThemeId(theme.id)) {
    applyImmersionToRoot(BARE_IMMERSION);
  } else {
    fetchMasterImmersion()
      .then(applyImmersionToRoot)
      .catch(() => applyImmersionToRoot(DEFAULT_IMMERSION));
  }
}

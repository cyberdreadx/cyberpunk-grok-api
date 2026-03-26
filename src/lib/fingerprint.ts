/**
 * Lightweight, dependency-free browser fingerprint generator.
 * Collects stable, non-invasive signals and hashes them into a
 * short hex string that is consistent across sessions on the same device.
 *
 * Signals used (all read-only, no permissions required):
 *   userAgent, platform, screen resolution, color depth, pixel ratio,
 *   timezone, language, hardware concurrency, canvas fingerprint.
 *
 * NOT a perfect de-anonymiser — it's a friction layer against casual
 * multi-account creation, not a surveillance tool.
 */

/** FNV-1a 32-bit hash — fast, no crypto API needed. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // keep 32-bit unsigned
  }
  return hash;
}

/** Draw a small canvas and return a data URL that varies by GPU/font rendering. */
function canvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 100, 40);
    ctx.fillStyle = "#069";
    ctx.fillText("GrokRunner🔬", 2, 4);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.fillText("GrokRunner🔬", 4, 18);
    // Read only a 40-char slice to keep the signal short
    return canvas.toDataURL("image/png").slice(0, 120);
  } catch {
    return "canvas-error";
  }
}

/** Collect all stable signals into a single concatenated string. */
function collectSignals(): string {
  const nav = navigator;
  const scr = screen;
  return [
    nav.userAgent,
    nav.language || "",
    (nav.languages || []).join(","),
    nav.platform || "",
    String(nav.hardwareConcurrency || 0),
    String(scr.width),
    String(scr.height),
    String(scr.colorDepth),
    String(window.devicePixelRatio || 1),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasFingerprint(),
  ].join("|");
}

/** Cache the fingerprint for the session so we don't recompute. */
let _cached: string | null = null;

/**
 * Returns a stable hex fingerprint for this browser/device combination.
 * Result is memoised within the page session.
 */
export function getBrowserFingerprint(): string {
  if (_cached) return _cached;
  const signals = collectSignals();
  const hash = fnv1a(signals);
  _cached = hash.toString(16).padStart(8, "0");
  return _cached;
}

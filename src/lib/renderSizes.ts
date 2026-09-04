/**
 * Output dimensions, in one place.
 *
 * These lists were previously duplicated: the Z-Image buckets existed inline
 * in Classic's picker JSX and again, as a hand-picked three, inside Easy mode.
 * They happened to agree, which is not the same as being kept in agreement —
 * a change to either would have silently diverged from the other.
 *
 * Every pair is divisible by 32. That satisfies LTX (which requires it), WAN's
 * /16, and ComfyUI's EmptyLatentImage (which floors to /8), so one rule covers
 * every consumer and a label always matches the file that comes back.
 */

/* ── Still images (Z-Image Turbo) ─────────────────────────────────
 * The standard ~1 MP aspect buckets. Z-Image is trained at 1 MP, so straying
 * far from it either skews the composition or wastes the latent.
 */
export type ZimageAspect = "1:1" | "4:3" | "3:2" | "16:9" | "3:4" | "2:3" | "9:16";

export const ZIMAGE_SIZES: Record<ZimageAspect, [number, number]> = {
  "1:1": [1024, 1024],
  "4:3": [1152, 896],
  "3:2": [1216, 832],
  "16:9": [1344, 768],
  "3:4": [896, 1152],
  "2:3": [832, 1216],
  "9:16": [768, 1344],
};

/** Display order for the full picker: landscape row, then portrait row. */
export const ZIMAGE_ORDER: ZimageAspect[] = ["1:1", "4:3", "3:2", "16:9", "3:4", "2:3", "9:16"];

/**
 * Easy mode deliberately offers three of the seven, under plain names — the
 * whole point of that mode is not making people choose between 4:3 and 3:2.
 * They resolve through ZIMAGE_SIZES rather than carrying their own numbers, so
 * Easy cannot drift from Classic again.
 */
export const EASY_ASPECTS = [
  { id: "portrait", label: "Portrait", aspect: "2:3" },
  { id: "square", label: "Square", aspect: "1:1" },
  { id: "landscape", label: "Landscape", aspect: "3:2" },
] as const satisfies ReadonlyArray<{ id: string; label: string; aspect: ZimageAspect }>;

/* ── Video (RENDER mode) ──────────────────────────────────────────
 * Pixel counts are held near each other across presets so a shape change
 * cannot quietly change render time on engines billed per clip or per second.
 *
 * COMFY reaches these indirectly: buildGltchWanWorkflow ignores the width and
 * height it is handed and takes the video's shape from resizing the Z-Image
 * start frame into a `resolution` x `resolution` box (ImageResizeKJv2,
 * keep_proportion, divisible_by 16). Passing the pair's long edge as
 * `resolution` reproduces the pair exactly, since the start frame already
 * carries the ratio.
 *
 * LTX renders at 2x COMFY's sizes because it renders them NATIVELY. The x2
 * latent upscale tail was tried first and produced visibly worse output — it
 * adds resolution while smoothing away the strand and pore detail the sampler
 * had already produced. Rendering 960x1664 directly beats rendering 480x832
 * and upsampling to the same dimensions, at 21s against 7s of sampling, which
 * is noise next to cold-start model loading. Verified at the longest preset
 * too: 361 frames at 960x1664 renders in 272s with no drift by frame 340.
 *
 * WAN deliberately does NOT follow. It is trained at 480p/720p buckets, so
 * 1664x960 would be well outside its training resolution.
 */
export type RenderAspect = "16:9" | "3:2" | "1:1" | "2:3" | "9:16";

export const RENDER_SIZES: Record<RenderAspect, { comfy: [number, number]; ltx: [number, number] }> = {
  "16:9": { comfy: [832, 480], ltx: [1664, 960] },
  "3:2": { comfy: [768, 512], ltx: [1536, 1024] },
  "1:1": { comfy: [640, 640], ltx: [1280, 1280] },
  "2:3": { comfy: [512, 768], ltx: [1024, 1536] },
  "9:16": { comfy: [480, 832], ltx: [960, 1664] },
};

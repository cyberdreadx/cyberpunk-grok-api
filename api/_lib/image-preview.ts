/**
 * Server-side image/video preview generation.
 * Images: Sharp resize → WebP.
 * Videos: ffmpeg first-frame extract → Sharp resize → WebP.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);
const PREVIEW_MAX = 480;

export async function generateImagePreviewBuffer(
  buffer: Buffer,
  contentType: string,
): Promise<Buffer | null> {
  if (contentType.startsWith("video/") || contentType === "application/octet-stream") {
    return generateVideoThumbnailBuffer(buffer);
  }
  if (!contentType.startsWith("image/")) return null;
  if (contentType.includes("gif")) return null;

  try {
    const sharp = (await import("sharp")).default;
    return sharp(buffer)
      .rotate()
      .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err: any) {
    console.warn("[image-preview] generate failed:", err?.message || err);
    return null;
  }
}

async function generateVideoThumbnailBuffer(buffer: Buffer): Promise<Buffer | null> {
  const tmp = os.tmpdir();
  const id = `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const inPath = path.join(tmp, `${id}.mp4`);
  const outPath = path.join(tmp, `${id}.jpg`);
  try {
    await fs.writeFile(inPath, buffer);
    // Extract frame at 0.5s (or first keyframe if shorter)
    await execFileAsync("ffmpeg", [
      "-ss", "0.5", "-i", inPath,
      "-frames:v", "1", "-q:v", "3",
      "-y", outPath,
    ], { timeout: 15000 });
    const frame = await fs.readFile(outPath);
    const sharp = (await import("sharp")).default;
    return sharp(frame)
      .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err: any) {
    console.warn("[image-preview] video thumb failed:", err?.message || err);
    return null;
  } finally {
    await Promise.all([fs.unlink(inPath).catch(() => {}), fs.unlink(outPath).catch(() => {})]);
  }
}

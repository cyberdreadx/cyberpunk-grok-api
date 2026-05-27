/**
 * /api/blob-upload — Legacy Vercel Blob client upload handler.
 * Prefer /api/media-upload (direct-to-R2) for new uploads when R2 is configured.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { verifyToken } from "./_lib/auth";
import { applyCors } from "./_lib/cors";
import { isR2MediaConfigured } from "./_lib/media-storage";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token =
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.grokrun_READ_WRITE_TOKEN ||
    "";
  if (!token) return res.status(503).json({ error: "Blob storage not configured" });

  if (isR2MediaConfigured()) {
    console.warn("[blob-upload] R2 is configured — prefer /api/media-upload to avoid Blob egress charges");
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      token,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const jwt = clientPayload ? verifyToken(clientPayload) : null;
        if (!jwt) throw new Error("Unauthorized");
        return {
          addRandomSuffix: true,
          allowedContentTypes: [
            "image/png", "image/jpeg", "image/webp",
            "video/mp4", "video/webm",
          ],
          maximumSizeInBytes: 50 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
}

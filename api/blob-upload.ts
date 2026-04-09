import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { verifyToken } from "./_lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token =
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.grokrun_READ_WRITE_TOKEN ||
    "";
  if (!token) return res.status(503).json({ error: "Blob storage not configured" });

  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      token,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const jwt = clientPayload ? verifyToken(clientPayload) : null;
        if (!jwt) throw new Error("Unauthorized");
        return {
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

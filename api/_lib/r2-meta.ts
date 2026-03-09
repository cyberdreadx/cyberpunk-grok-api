/**
 * Helper to read share metadata JSON from R2.
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

function getR2(): S3Client {
  if (!s3Client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 credentials not configured");
    }
    s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return s3Client;
}

const BUCKET = process.env.R2_BUCKET_NAME || "grokker-media";

export interface ShareMeta {
  mediaKey: string;
  mediaType: "image" | "video";
  prompt: string;
  createdAt: string;
}

/** Read and parse a share metadata JSON from R2 */
export async function getR2Meta(key: string): Promise<ShareMeta> {
  const client = getR2();
  const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await resp.Body?.transformToString();
  if (!body) throw new Error("Empty metadata");
  return JSON.parse(body) as ShareMeta;
}

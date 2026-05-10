/**
 * Cloudflare R2 (S3-compatible) helpers for media storage.
 * Used by share links and Grokker cross-post.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3Client: S3Client | null = null;

function getR2(): S3Client {
  if (!s3Client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
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

/** Upload a buffer directly to R2 */
export async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = getR2();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/** Check if an object exists in R2 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    const client = getR2();
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Generate a presigned download URL (GET) — 1 hour expiry */
export async function getDownloadUrl(key: string): Promise<string> {
  const client = getR2();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

/** Construct the public R2 URL (requires bucket to have public access enabled) */
export function getPublicUrl(key: string): string {
  const customDomain = process.env.R2_PUBLIC_DOMAIN;
  if (customDomain) return `https://${customDomain}/${key}`;
  // Fallback: use R2.dev public URL
  const bucketPublic = process.env.R2_PUBLIC_BUCKET_URL;
  if (bucketPublic) return `${bucketPublic}/${key}`;
  // Last resort: presigned will be used instead
  return "";
}

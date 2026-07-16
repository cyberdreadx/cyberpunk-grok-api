/**
 * Cloudflare R2 (S3-compatible) helpers for media storage.
 * Used by share links and Grokker cross-post.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

const DEFAULT_CACHE = "public, max-age=31536000, immutable";

/** True when R2 credentials + a public URL base are configured. */
export function isR2MediaConfigured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    (process.env.R2_PUBLIC_BUCKET_URL || process.env.R2_PUBLIC_DOMAIN)
  );
}

/** Upload a buffer directly to R2 */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string,
  opts?: { cacheControl?: string },
): Promise<void> {
  const client = getR2();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: opts?.cacheControl ?? DEFAULT_CACHE,
  }));
}

/** Presigned PUT URL — client uploads directly to R2 (no Vercel egress). */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  const client = getR2();
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    CacheControl: DEFAULT_CACHE,
  });
  return getSignedUrl(client, command, { expiresIn });
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

/** Returns true if the URL appears to be hosted on this project's R2 bucket. */
export function isR2Url(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const customDomain = (process.env.R2_PUBLIC_DOMAIN || "").toLowerCase();
    const bucketPublic = (process.env.R2_PUBLIC_BUCKET_URL || "").toLowerCase();
    const host = u.host.toLowerCase();
    if (customDomain && host === customDomain) return true;
    if (bucketPublic) {
      try { if (host === new URL(bucketPublic).host) return true; } catch {}
    }
    return /\.r2\.cloudflarestorage\.com$/i.test(host) || /\.r2\.dev$/i.test(host);
  } catch { return false; }
}

/** Extract the object key from a public R2 URL (or return null if not parseable). */
export function r2KeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "") || null;
  } catch { return null; }
}

/**
 * Best-effort delete a list of R2 object keys.
 * Returns `{ found, deleted, failed }` so callers can record audit trails.
 * R2's batch DeleteObjects with Quiet:true only surfaces errors, not
 * per-key successes, so we estimate `deleted = found - failed`.
 */
export async function deleteR2Objects(
  keys: string[],
): Promise<{ found: number; deleted: number; failed: number }> {
  const filtered = keys.filter(Boolean);
  const found = filtered.length;
  if (found === 0) return { found: 0, deleted: 0, failed: 0 };
  let failed = 0;
  let batchErrors = 0;
  try {
    const client = getR2();
    for (let i = 0; i < filtered.length; i += 1000) {
      const chunk = filtered.slice(i, i + 1000);
      try {
        const resp: any = await client.send(new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }));
        failed += (resp?.Errors?.length || 0);
      } catch (err: any) {
        batchErrors += chunk.length;
        console.warn("[r2] batch delete failed:", err?.message || err);
      }
    }
  } catch (err: any) {
    console.warn("[r2] delete skipped:", err?.message || err);
    batchErrors += filtered.length;
  }
  failed += batchErrors;
  return { found, deleted: Math.max(0, found - failed), failed };
}

/** List every object key (+ last-modified) under a prefix. Throws on failure. */
export async function listR2Objects(
  prefix: string,
): Promise<Array<{ key: string; lastModified?: Date }>> {
  const client = getR2();
  const out: Array<{ key: string; lastModified?: Date }> = [];
  let token: string | undefined = undefined;
  do {
    const resp: any = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    for (const o of resp.Contents || []) {
      if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Best-effort list + delete all R2 objects under a key prefix. */
export async function deleteR2Prefix(prefix: string): Promise<number> {
  if (!prefix) return 0;
  let deleted = 0;
  try {
    const client = getR2();
    let token: string | undefined = undefined;
    do {
      const resp: any = await client.send(new ListObjectsV2Command({
        Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
      }));
      const keys = (resp.Contents || []).map((o: any) => o.Key).filter(Boolean);
      if (keys.length > 0) {
        await deleteR2Objects(keys);
        deleted += keys.length;
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
  } catch (err: any) {
    console.warn("[r2] prefix delete failed:", err?.message || err);
  }
  return deleted;
}

/**
 * Give already-uploaded R2 media a Cache-Control header.
 *
 * Client uploads go through a presigned PUT, and a presigned upload only stores
 * the headers the client sends. mediaUpload.ts sent Content-Type alone, so
 * years of images and videos sit in R2 with no Cache-Control — browsers then
 * revalidate on essentially every view, which is twenty round trips before a
 * feed paints. The upload path is fixed; this is the existing objects.
 *
 * CopyObject with MetadataDirective REPLACE rewrites the header server-side —
 * the bytes are never downloaded or re-uploaded, so this is cheap and lossless.
 *
 *   npx tsx --env-file=.env scripts/backfill-cache-headers.mts --prefix=feed/
 *   npx tsx --env-file=.env scripts/backfill-cache-headers.mts --prefix=feed/ --apply
 */

import { S3Client, ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { R2_DEFAULT_CACHE } from "../api/_lib/r2";

const APPLY = process.argv.includes("--apply");
const PREFIX = process.argv.find((a) => a.startsWith("--prefix="))?.split("=")[1] ?? "";
const MAX = Number(process.argv.find((a) => a.startsWith("--max="))?.split("=")[1] || 5000);

const BUCKET = process.env.R2_BUCKET_NAME || "grokker-media";
const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — prefix "${PREFIX || "(whole bucket)"}", cap ${MAX}\n`);

let token: string | undefined;
let listed = 0, missing = 0, fixed = 0, failed = 0, skipped = 0;

outer:
while (true) {
  const page = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET, Prefix: PREFIX || undefined, ContinuationToken: token, MaxKeys: 1000,
  }));
  for (const obj of page.Contents ?? []) {
    if (listed >= MAX) break outer;
    const key = obj.Key!;
    listed++;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      if (head.CacheControl) { skipped++; continue; }
      missing++;
      if (APPLY) {
        // Copy onto itself, replacing metadata. ContentType must be restated or
        // the copy loses it — which would be a far worse bug than the one being
        // fixed, since the browser would stop recognising the file type.
        await client.send(new CopyObjectCommand({
          Bucket: BUCKET,
          Key: key,
          CopySource: `${BUCKET}/${encodeURIComponent(key)}`,
          MetadataDirective: "REPLACE",
          CacheControl: R2_DEFAULT_CACHE,
          ContentType: head.ContentType,
        }));
        fixed++;
      }
      if (missing <= 10) console.log(`  ${head.ContentType ?? "?"}  ${key.slice(-66)}`);
    } catch (err: any) {
      failed++;
      if (failed <= 5) console.log(`  ERROR ${key.slice(-60)}: ${err?.message}`);
    }
    if (listed % 500 === 0) console.log(`  ...${listed} examined, ${missing} missing a header`);
  }
  if (!page.IsTruncated) break;
  token = page.NextContinuationToken;
}

console.log(`\n  examined          : ${listed}`);
console.log(`  already cached    : ${skipped}`);
console.log(`  missing the header: ${missing}`);
console.log(`  rewritten         : ${fixed}${APPLY ? "" : "  (dry run — nothing changed)"}`);
if (failed) console.log(`  errors            : ${failed}`);

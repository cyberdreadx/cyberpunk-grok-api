/**
 * Configure CORS on the R2 media bucket.
 *
 * Browser uploads go presign (/api/media-upload) → PUT straight to R2. That
 * PUT is cross-origin, so without a CORS policy the preflight is rejected with
 * "CORS not configured for this bucket" and every upload silently falls back
 * to Vercel Blob — which costs egress and, once the Blob callbackUrl broke on
 * self-hosted, failed outright. That's what took feed posts and stories down.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/setup-r2-cors.ts        # show current
 *   node --env-file=.env --import tsx scripts/setup-r2-cors.ts --apply
 */
import {
  S3Client, PutBucketCorsCommand, GetBucketCorsCommand,
} from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME || "grokker-media";
if (!accountId || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY required");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

/**
 * Explicit origins only — a wildcard would let any site presign-and-upload
 * through a stolen token. Extra origins can be added via R2_CORS_ORIGINS.
 */
const ORIGINS = [
  "https://grokrunner.gltch.app",
  "https://gltchrunner.com",
  "https://www.gltchrunner.com",
  "http://localhost:5173",
  "http://localhost:8080",
  ...(process.env.R2_CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
];

const RULES = [
  {
    AllowedOrigins: ORIGINS,
    // PUT is the upload itself; GET/HEAD let the app read media back.
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["content-type", "content-length", "x-amz-*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

async function show() {
  try {
    const cur = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log(`current CORS on ${bucket}:`);
    console.log(JSON.stringify(cur.CORSRules, null, 2));
  } catch (e: any) {
    console.log(`current CORS on ${bucket}: NONE (${e?.name || e?.message})`);
  }
}

await show();

if (!process.argv.includes("--apply")) {
  console.log("\nwould apply:");
  console.log(JSON.stringify(RULES, null, 2));
  console.log("\nDRY RUN — pass --apply to write");
  process.exit(0);
}

await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: RULES } }));
console.log("\napplied.");
await show();

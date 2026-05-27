/** One-off: probe R2 bucket connectivity. Run with env from `vercel env pull`. */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "grokker-media";
  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error("Missing R2 credentials");
    process.exit(1);
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const resp = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 5 }));
  console.log(JSON.stringify({
    bucket,
    objectCount: resp.KeyCount ?? 0,
    sampleKeys: (resp.Contents || []).map((o) => o.Key),
    publicUrlEnv: process.env.R2_PUBLIC_BUCKET_URL || process.env.R2_PUBLIC_DOMAIN || null,
  }, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

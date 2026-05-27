/**
 * Verify R2 public URL works after setting R2_PUBLIC_BUCKET_URL on Vercel.
 * Run: npx tsx scripts/verify-r2-public.ts
 */
import { uploadPublicMedia, isR2MediaConfigured } from "../api/_lib/media-storage";

async function main() {
  if (!isR2MediaConfigured()) {
    console.error(`
R2 public URL not configured.

1. Cloudflare → R2 → grokker-media → Settings
2. Enable "Public Development URL" (or connect custom domain)
3. Copy the URL (https://pub-xxxxx.r2.dev)
4. Vercel → cyberpunk-grok-api → Settings → Environment Variables:
     R2_PUBLIC_BUCKET_URL=https://pub-xxxxx.r2.dev
     R2_BUCKET_NAME=grokker-media
5. Redeploy
`);
    process.exit(1);
  }

  const key = `r2-test/${Date.now()}-verify.txt`;
  const body = Buffer.from(`ok @ ${new Date().toISOString()}`);
  const { url, storage } = await uploadPublicMedia(body, key, "text/plain");
  const resp = await fetch(url);
  const text = await resp.text();

  if (!resp.ok) {
    console.error("Upload succeeded but public fetch failed:", resp.status, url);
    process.exit(1);
  }

  console.log("R2 OK:", { storage, url, body: text.slice(0, 80) });
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

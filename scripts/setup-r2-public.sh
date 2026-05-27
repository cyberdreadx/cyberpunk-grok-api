#!/usr/bin/env bash
# Verify R2 is ready to replace Vercel Blob (free egress vs ~$0.15/GB).
#
# Prerequisites (Cloudflare dashboard):
#   1. R2 bucket "grokker-media" exists
#   2. Settings → Public Development URL enabled → copy https://pub-xxxxx.r2.dev
#   3. Add to Vercel env:
#        R2_PUBLIC_BUCKET_URL=https://pub-xxxxx.r2.dev
#        R2_BUCKET_NAME=grokker-media
#        (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY already set)
#
# Usage:
#   vercel env pull .env.local && source .env.local  # or export vars manually
#   npx tsx scripts/probe-r2.ts
#   npx tsx scripts/verify-r2-public.ts

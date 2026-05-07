# ⚡ GROK_RUNNER

> Cyberpunk neural interface for AI image, video, and character generation — multi-engine, multi-payment, creator-friendly.

![Banner](public/og-image.png)

**Live:** [grokrunner.gltch.app](https://grokrunner.gltch.app)
**Current version:** v4.9 (2026.05.06)

## ✨ What it does

A cyberpunk-themed app for generating, editing, and sharing AI media. It bundles four generation engines, a creator-monetized social feed, 24-hour stories, character chat, $XRGE crypto payments, and a public developer API behind one terminal-flavored interface.

### Generation modes

| Mode | What it does |
|------|--------------|
| 🖼️ **GENERATE** | Text → Image |
| ✏️ **MODIFY** | Edit existing images with prompts (Flux 2 Klein) |
| 🎬 **RENDER** | Text → Video (up to 15s, WAN 2.2 + RIFE) |
| 🎞️ **ANIMATE** | Image → Video (start/end frame interpolation) |
| 🧬 **CHARACTERS** | Persistent AI personalities with vision + media generation |

### Engines

- **GLTCH PRO** (ComfyUI) — best quality, full LoRA stack, NSFW unlocks
- **GLTCH** (default) — fast and balanced
- **GROK** (xAI) — official xAI Imagine pipeline

## 🆕 Recent highlights (v4.9)

- **XRGE Holder program** — tiers from holding XRGE (wallet + bank), daily snapshots, streak multipliers; Holder tab in XRGE Bank and profile badge
- **Discounts that bill correctly** — holder savings stack with subscription discounts on generations (including SEEDANCE and the public API)
- **Daily credits** — 10 base for verified users plus extra dailies for Operative+ tiers based on streak
- **ComfyUI billing fix** — chained free steps restricted to the Z-Image start-frame workflow with rate limits

See the in-app **Changelog** dialog for the full history.

## 🔑 Account & payment options

- **BYOK** — bring your own xAI / RunPod key, 100% client-side, never sent to us
- **Credits** — Stripe checkout for one-time packs and monthly subscriptions
- **$XRGE on Base** — pay or get paid in crypto; 80% of XRGE post/story unlocks go straight to the creator's wallet
- **10 free daily credits** for verified accounts
- **Daily Missions, Spin the Wheel, Referrals, Flash Sales** — gamified credit boosts

## 🎨 Creator platform

- Post images and 24-hour stories with optional credit / USD / $XRGE locks
- Revenue split: **75/20/5** for credits & USD, **80/20** for $XRGE (instant on-chain)
- Manual USD payouts ($25 min) or instant $XRGE conversion ($1 min)
- Verified creator badges, follow/follower system, comment threads

See [CREATOR-PLATFORM.md](CREATOR-PLATFORM.md) for the full spec.

## 🔒 Privacy at a glance

| Data | Where it lives | When it's deleted |
|------|----------------|-------------------|
| Generated media (default) | Your browser (IndexedDB) | When you clear it |
| BYOK API keys | Your browser (localStorage) | Never sent to us |
| Feed posts / avatars | Vercel Blob (server) | Auto-purged on delete |
| Stories | Vercel Blob (server) | Auto-deleted after 24h |
| Share links (`/s/:id`) | Vercel Blob (server) | Auto-purged when you delete the source result |
| Account email + bcrypt hash | Neon Postgres | On account deletion |
| Prompt text | **Not stored**, except for daily-mission verification & flagged-post moderation |

A weekly cron also sweeps Blob storage for orphaned files (with a 24-hour safety window). Full details in the in-app **Privacy Protocol** dialog.

## 🚀 Quick start

```bash
npm install
npm run dev        # local dev
npm run build      # production build
```

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind + shadcn/ui)          │
│  BYOK mode → calls xAI / RunPod directly                 │
│  Credits mode → calls /api/* serverless functions        │
└────────────────────────┬─────────────────────────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  Vercel Serverless Functions  │
         │  /api/auth/*    /api/generate │
         │  /api/credits   /api/comfyui  │
         │  /api/checkout  /api/feed     │
         │  /api/xrge-*    /api/stories  │
         │  /api/share     /api/v1/*     │
         │  /api/cron-blob-orphans (wk)  │
         └────┬──────────┬──────────┬────┘
              │          │          │
       ┌──────▼──┐  ┌────▼────┐  ┌──▼──────────┐
       │  Neon   │  │ Stripe  │  │ Vercel Blob │
       │ Postgres│  │ + XRGE  │  │  (media)    │
       └─────────┘  └─────────┘  └─────────────┘
```

## 🔧 Environment variables

Copy `.env.example` and fill in the values you need. Core requirements:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Neon Postgres connection string |
| `JWT_SECRET` | ✅ | Random 64-char string for signing tokens |
| `XAI_API_KEY` | ✅ | xAI key for credit-mode Grok proxy |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret |
| `STRIPE_PRICE_*` | ✅ | Stripe Price IDs for packs and subscriptions |
| `RESEND_API_KEY` | ✅ | Email delivery (verification, 2FA, alerts) |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob token for posts/stories/shares |
| `SITE_URL` | ✅ | Frontend URL for redirects |
| `RUNPOD_*` / `COMFYUI_URL` | optional | Enable GLTCH / GLTCH PRO engines |
| `XRGE_*` | optional | Enable $XRGE crypto payments on Base |
| `DEEPSEEK_API_KEY` | optional | Alternate backend for character chat |

See `.env.example` for the full list.

## ❓ FAQ

**Where do my generations go?**
By default, nowhere — they live in your browser's IndexedDB. Files only hit our server when you explicitly post to the feed, publish a story, set an avatar, or create a `/s/:id` share link.

**What happens when I delete something?**
The database row goes first, then the underlying Vercel Blob is auto-purged. A weekly cron also sweeps for any orphaned files with a 24-hour safety window. Stories self-destruct after 24 hours regardless.

**Do you store my prompts?**
Not by default. We log generation type, credit cost, and timestamp for billing. Prompt text is only kept when needed to verify a daily-mission action (e.g. `shared:<id>`) or to moderate a flagged feed post.

**What's BYOK and is it safer?**
"Bring Your Own Key" lets you paste your own xAI / RunPod API key. It's stored only in your browser's localStorage and never reaches our servers. In BYOK mode, your prompts go straight from your browser to the AI provider.

**Do credits expire?**
- **Subscription credits** reset every billing cycle (no rollover).
- **Pack credits** never expire.
- **Daily free credits** (10/day) reset every 24 hours for verified accounts.

**How do creator earnings work?**
- Posts/stories locked in **credits or USD** — split 75% creator / 20% platform / 5% reserve. USD payouts manual review at $25 min.
- Posts/stories locked in **$XRGE** — split 80% creator / 20% platform, paid **instantly** on-chain to the creator's Base wallet. Convert in-app earnings to $XRGE at $1 min.

**Is this 18+?**
Yes. The Platform requires age confirmation and account verification. NSFW LoRAs unlock for users with a $30 Stripe purchase, an $XRGE pack, or an $XRGE deposit. CSAM and non-consensual imagery are zero-tolerance — see the in-app Terms of Service.

**Can I self-host?**
Yes — the frontend works in BYOK mode on any static host. For the SaaS features you'll need to deploy the `api/` folder to Vercel and provide Neon + Stripe + Blob credentials. See [SELF-HOSTING.md](SELF-HOSTING.md).

**How do I delete my account?**
Settings → Delete Account. Your profile, posts, stories, and any associated media files are removed.

**Where can I report abuse or DMCA?**
Email `dmca@grokrunner.gltch.app` for copyright. Use the in-app report flow on any post, story, or profile for community-guideline issues — flagged content is auto-removed at 6 unique reports.

## 🏠 Self-hosting

See [SELF-HOSTING.md](SELF-HOSTING.md) for Docker, iSH, and static-server instructions.

## 🛠️ Tech stack

**Frontend:** React 18 · TypeScript · Vite · Tailwind · shadcn/ui · IndexedDB · vite-plugin-pwa · react-i18next (10 languages, RTL)
**Backend:** Vercel Serverless Functions · Neon Postgres · bcryptjs + JWT · Vercel Blob
**Generation:** xAI Grok · RunPod (ComfyUI: Flux 2 Klein, WAN 2.2, Z-Image Turbo) · DeepSeek
**Payments:** Stripe · $XRGE on Base
**Integrations:** Resend (email) · Telegram bot

## 📝 License

Private project. All rights reserved.

# ⚡ GROK_IMAGINE

> Cyberpunk neural rendering interface for xAI's Grok Imagine API.

![GROK_IMAGINE Banner](public/og-image.png)

**Live:** [grokrunner.gltch.app](https://grokrunner.gltch.app)

## ✅ Recent Updates

- **PayPal for credit packs** (alongside Stripe) with server-side capture + idempotency
- **Folder Vault system** — hide folders from main tabs, restore from discreet vault menu
- **Safer folder deletion** — confirmation modal with clear consequences; contents move to `UNFILED`
- **Mobile folder UX upgrades** — larger tap targets and easier menu interactions
- **Improved error extraction** — clearer Stripe/xAI error messages and BYOK billing hints
- **Bundle splitting in Vite** — app chunk reduced significantly for faster repeat loads

## What is this?

A cyberpunk-themed web app for the [xAI Grok Imagine API](https://docs.x.ai/docs/guides/image-generation) — generate images, edit them, create videos, and animate stills. Works in two modes:

- **BYOK (Bring Your Own Key)** — 100% client-side, your API key never leaves the browser
- **Credits** — Sign up, buy credits or subscribe, and use xAI features without managing an API key

### Modes

| Mode | Description |
|------|-------------|
| 🖼️ **GENERATE** | Text → Image generation |
| ✏️ **MODIFY** | Edit existing images with prompts |
| 🎬 **RENDER** | Text → Video generation (up to 15s) |
| 🎞️ **ANIMATE** | Image → Video animation |

### Features

- **Dual API Mode** — BYOK (free, client-side) or Credits (paid, server-proxied)
- **Settings Panel** — Resolution (512² to 1792×1024), batch count (×1–×4), video duration (5–15s)
- **Prompt History** — Auto-saved, searchable, reusable prompts
- **Results Gallery** — Expand, download, delete individual items, carousel view
- **Folder Management** — Create/rename/delete folders, move outputs, PIN lock support
- **Vault Mode** — Hide folders from main tabs and restore them from vault controls
- **IndexedDB Storage** — Persistent local storage for generated media (survives cache clears)
- **Download Proxy** — Server-side proxy for video downloads (bypasses xAI CDN CORS restrictions)
- **PWA Support** — Install on any device as a native-feeling app
- **Mobile Optimized** — Share sheet integration, swipe gestures, responsive layout

### SaaS Features

- **User Authentication** — Custom JWT-based signup/login
- **Credit System** — Pay-per-use credits with sub-credits (subscription) and pack-credits (one-time)
- **Stripe Integration** — One-time credit packs, monthly subscriptions, customer portal
- **PayPal Integration** — One-time credit packs as an alternate checkout path
- **Monthly Plans** — Basic and Premium tiers with auto-renewing credits (no rollover)
- **API Proxy** — Server-side xAI API calls for credit users (key stays on server)

## 🔒 Privacy

| Concern | BYOK Mode | Credits Mode |
|---------|-----------|--------------|
| API key | Browser localStorage only | Stored on server (encrypted) |
| API calls | Direct to `api.x.ai` | Proxied through backend |
| Data persistence | All local (IndexedDB) | All local (IndexedDB) |
| Telemetry | None | Usage logging for credit billing |

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│  Frontend (Netlify / any static host)            │
│  React + Vite + Tailwind + shadcn/ui             │
│                                                  │
│  BYOK mode: calls xAI API directly              │
│  Credits mode: calls /api/* backend              │
└────────────────────┬─────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │  Backend (Vercel)   │
          │  Serverless Funcs   │
          │                     │
          │  /api/auth/*        │  ← JWT auth
          │  /api/credits       │  ← credit balance
          │  /api/checkout      │  ← Stripe sessions
│  /api/paypal        │  ← PayPal create/capture
          │  /api/webhook       │  ← Stripe webhooks
          │  /api/generate      │  ← xAI proxy
          │  /api/download      │  ← media proxy
          └──────┬──────┬───────┘
                 │      │
        ┌────────▼┐  ┌──▼────────┐
        │  Neon   │  │  Stripe   │
        │ Postgres│  │ Payments  │
        └─────────┘  └───────────┘
```

A **Netlify Function** (`/.netlify/functions/download`) also provides the download proxy directly from the frontend host, so video downloads work without the Vercel backend.

## 🔧 Environment Variables

Copy `.env.example` and fill in your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Backend | Neon Postgres connection string |
| `JWT_SECRET` | Backend | Random 64-char string for signing tokens |
| `XAI_API_KEY` | Backend | xAI API key for credit-mode proxy |
| `STRIPE_SECRET_KEY` | Backend | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Backend | Stripe webhook signing secret |
| `STRIPE_PRICE_*` | Backend | Stripe Price IDs for packs and subscriptions |
| `SITE_URL` | Backend | Frontend URL for Stripe redirects |
| `PAYPAL_CLIENT_ID` | Backend | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | Backend | PayPal app secret |
| `PAYPAL_SANDBOX` | Backend | `true` for sandbox testing, `false` for live |
| `VITE_API_URL` | Frontend | Backend API URL (only if on a different domain) |
| `VITE_PAYPAL_CLIENT_ID` | Frontend | Enables PayPal button rendering in UI |

## 🏠 Self-Hosting

See [SELF-HOSTING.md](SELF-HOSTING.md) for complete instructions on running privately via:

- 📱 **iPhone (iSH terminal)**
- 🐳 **Docker** (Synology, QNAP, Unraid, TrueNAS)
- 💻 **Any static server** (npx serve, Python, PHP)
- 🔐 **Tailscale / ZeroTier** for secure remote access

> **Note:** Self-hosting the frontend gives you BYOK mode. For the credit/SaaS features, you'll also need to deploy the Vercel backend and set up Neon + Stripe.

## 💳 SaaS Setup

To enable the credit-based SaaS features:

1. **Database** — Create a [Neon](https://neon.tech) Postgres project and run `supabase/migrations/20260209_saas_credits.sql`
   - Also run `supabase/migrations/20260211_paypal_transactions.sql` for PayPal idempotency support
2. **Stripe** — Create products using `scripts/setup-stripe-products.ps1` (Windows) or `scripts/setup-stripe-products.sh` (Mac/Linux)
3. **PayPal (optional)** — Create sandbox/live app credentials in the PayPal Developer Dashboard
4. **Backend** — Deploy the `api/` folder to [Vercel](https://vercel.com) and configure environment variables
5. **Frontend** — Set `VITE_API_URL` to your Vercel deployment URL if hosted separately

## 🛠️ Tech Stack

**Frontend:**
- React 18 + TypeScript + Vite
- Tailwind CSS with custom cyberpunk design system
- shadcn/ui components
- IndexedDB for persistent media storage
- PWA via vite-plugin-pwa
- Fonts: Orbitron, Share Tech Mono, Rajdhani

**Backend:**
- Vercel Serverless Functions (Node.js)
- Neon Postgres (serverless driver)
- Custom JWT authentication (bcryptjs + jsonwebtoken)
- Stripe + PayPal for payments

**Hosting:**
- Frontend: Netlify (with Netlify Functions for download proxy)
- Backend: Vercel
- Database: Neon Postgres

## 📝 License

Private project. All rights reserved.

# Creator Platform (Fanvue-style) — Planning Doc

> Companion platform for Grok Runner where AI content creators can post, sell, and monetize their generated content.

## Concept

Creators generate images/videos on Grok Runner, then post them to the creator platform where fans can subscribe, unlock content, and tip. Platform takes a 15-20% cut.

## Core Features

### Creator Profiles
- Public pages with bio, avatar, banner, social links
- Custom vanity URLs (e.g. `/creator/username`)
- Follower/subscriber counts
- Verification badges

### Content Feed
- Posts with images/videos, captions, tags
- Three access tiers:
  - **Free** — visible to everyone
  - **Subscriber-only** — monthly subscription required
  - **Pay-per-view (PPV)** — one-time unlock per post

### Subscriptions
- Fans pay monthly to unlock a creator's subscriber content
- Creators set their own price ($4.99–$49.99/mo)
- Platform takes 15-20% cut

### Pay-Per-View Unlocks
- One-time payment to unlock individual posts
- Creators set price per post ($1–$100)
- Platform takes same cut

### Grok Runner Integration
- "Post to [Platform]" button directly from Grok Runner results grid
- Auto-fills image/video, creator picks free/subscriber/PPV
- Seamless pipeline from generation to monetization

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind (same as Grok Runner) |
| Backend | Vercel Serverless Functions + Neon Postgres |
| Auth | JWT system (shared with Grok Runner) |
| Payments | **Stripe Connect** (marketplace payouts) |
| Media Storage | Cloudflare R2 (cheap, no egress fees) or AWS S3 |
| CDN | Cloudflare (signed/expiring URLs for paid content) |
| Search | Postgres full-text search (start), Meilisearch (scale) |

## Database Schema (High Level)

- `creators` — profile info, stripe_connect_account_id, payout settings
- `posts` — content, access_tier (free/subscriber/ppv), price, media_urls
- `subscriptions` — fan_id, creator_id, stripe_subscription_id, status
- `unlocks` — fan_id, post_id, amount_paid
- `follows` — fan_id, creator_id (free follows)
- `tips` — fan_id, creator_id, amount
- `media` — r2 bucket keys, signed URL metadata, content type

## Payment Flow (Stripe Connect)

1. Creator onboards via Stripe Connect Express (handles KYC, tax forms)
2. Fan subscribes or unlocks content
3. Payment goes through platform's Stripe account
4. Stripe automatically splits: 80-85% to creator, 15-20% to platform
5. Creators get payouts on their own schedule (daily/weekly/monthly)

## Content Protection

- Signed/expiring URLs for paid media (can't share direct links)
- Watermarking with creator username
- Disable right-click / drag on paid content (basic deterrent)
- DMCA takedown process
- Rate limiting on media requests

## Moderation & Legal

- **CSAM detection** — legally required, use PhotoDNA or similar
- **Age verification** — required if NSFW content is allowed
- **Content reporting** — flag/report system
- **DMCA handling** — takedown request process
- **Terms of Service** — creator agreement, acceptable use policy
- **Tax compliance** — 1099-K forms for US creators via Stripe Connect

## Revenue Model

- 15-20% platform fee on all creator earnings (subs, PPV, tips)
- Optional premium creator tools (analytics, scheduling, custom themes)
- Grok Runner credit bundles discounted for creators

## Complexity Estimate

| Component | Effort |
|-----------|--------|
| Creator profiles & feed | Medium |
| Stripe Connect integration | High |
| Media storage & CDN | Medium |
| Content protection | Medium |
| Subscription management | Medium |
| Discovery & search | Low-Medium |
| Moderation tools | Medium |
| Grok Runner integration | Low |
| Legal/compliance setup | High (non-code) |

**Overall: ~5-10x the scope of Grok Runner**

## MVP (Phase 1)

1. Creator signup + profile
2. Post images/videos (free + subscriber-only)
3. Fan subscriptions via Stripe Connect
4. Basic discovery/browse page
5. Grok Runner "Post to" integration

## Phase 2

- PPV unlocks
- Tips/donations
- Creator analytics dashboard
- Messaging/DMs
- Custom themes

## Phase 3

- Mobile app (React Native / Capacitor)
- Live streaming
- Collaborative posts
- Creator verification program
- Affiliate/referral system

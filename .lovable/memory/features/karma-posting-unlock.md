---
name: Karma posting unlock
description: Engagement-based posting gate — 200 karma + 48h + verified email unlocks feed/stories without a purchase
type: feature
---
# Karma posting unlock

Two paths unlock posting to feed/stories (in `api/_lib/purchaseGate.ts → canPost`):
1. Real purchase (Stripe pack/sub or XRGE spend > 0) — `hasPurchased`
2. **Karma path** — `hasKarmaUnlock`: ≥200 karma + email_verified + ≥48h account age

## Karma awards (`api/_lib/karma.ts`)
- upvote_received: +5  · comment_received: +2  · story_like_received: +1
- comment_post: +1 (cap 10/day) · like_given: +1 (cap 5/day, feed + stories)
- daily_mission: +3  · streak_bonus: +25

All awards are append-only via `karma_events` table keyed on a unique `source_key`
(e.g. `upvote_received:<reactionId>`), making them idempotent and revertible.
Undo a vote/comment → `revertKarma(source_key)` deducts cleanly.

## Schema
- `migrations/029_karma.sql` — `users.karma INT` + `karma_events` table
- `api/_lib/karma.ts` self-heals via `ensureSchema()` if migration hasn't run

## UI
- `/auth/me` returns `posting: { can_post, purchased, karma, karma_threshold, karma_unlock_ok, email_verified, account_age_hours, min_account_age_hours }`
- `useAuth.refreshUser()` exposed; auto-refreshes on `focus` and `karma-changed` events
- Action handlers (PostCard vote, CommentThread submit, StoryViewer like) dispatch `karma-changed` for live progress
- `<KarmaBadge>` component shows progress bar + "unlock instantly" CTA, rendered in FeedPage compose area

## Anti-abuse
- Daily caps on actor-side actions (comment_post, like_given)
- Bans wipe karma + delete karma_events (api/admin.ts ban-user case)
- Verified email + 48h age required at unlock check time

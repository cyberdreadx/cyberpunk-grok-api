

# User Ban System

## Overview
Add the ability to ban users from generating content, posting to the feed, and creating stories. Banned users see a clear message explaining they're banned.

## Database

**New migration** `018_user_bans.sql`:
- Create `user_bans` table with `user_id` (PK, references users), `reason`, `banned_by`, `created_at`
- Simple presence = banned; delete row = unbanned

## Backend Changes

**`api/_lib/auth.ts`** — Add a shared helper:
- `checkBan(sql, userId)` — queries `user_bans` for the user, returns `{ banned: boolean, reason?: string }`

**Enforce bans in 4 endpoints:**
1. `api/generate.ts` — check ban after auth, return 403 with message
2. `api/gltch.ts` — same check
3. `api/feed.ts` (POST) — block creating posts
4. `api/stories.ts` (POST) — block creating stories
5. `api/comfyui.ts` — block ComfyUI generations

Each returns: `{ error: "Your account has been suspended.", reason: "..." }`

**`api/admin.ts`** — Add 3 new actions:
- `ban-user`: takes email + reason, inserts into `user_bans`
- `unban-user`: takes userId, deletes from `user_bans`
- `list-bans`: returns all banned users with email/username/reason

## Frontend Changes

**`src/pages/Admin.tsx`** — Add a "Bans" section in the moderation tab:
- List of banned users (email, username, reason, date)
- Input to ban by email with a reason field
- Unban button per row

**`src/pages/Index.tsx` / generation UI** — When a 403 with "suspended" comes back, show a toast or dialog telling the user they're banned and why.

**`src/pages/FeedPage.tsx`** — Same handling on post creation failure.

## How It Works
- Admin enters an email in the ban panel, optionally with a reason
- That user immediately gets blocked from all generation endpoints, feed posts, and stories
- They see "Your account has been suspended" with the reason when they try to do anything
- Admin can unban at any time by clicking a button


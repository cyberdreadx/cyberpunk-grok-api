# GltchRunner Discord bot (scaffold)

A Discord bot that lets users run GltchRunner generations **in their DMs** using
their existing web credits. It links a Discord user to a GltchRunner web account,
mints a short-lived JWT for that user, and calls the **existing backend API** — so
all credit/gating/RunPod/R2 logic is reused, not re-implemented.

Mirrors the architecture of the sibling `telegram-bot/`.

## How it works
```
Discord user ──/link──▶ bot makes a code ──▶ user enters it on grokrunner.gltch.app
                                              (web sets discord_users.linked_user_id)
Discord user ──/generate──▶ bot mints JWT for linked user ──▶ POST api.gltch.app/api/comfyui
                                              ──▶ backend charges credits + renders ──▶ media URL
```

## Setup

1. **Create the Discord app** at https://discord.com/developers/applications
   - *Bot* → reset/copy **Token** → `DISCORD_TOKEN`.
   - *General Information* → **Application ID** → `DISCORD_CLIENT_ID`.
   - *Installation* → enable **User Install** (this is what makes commands work in
     DMs and anywhere the user goes). Set Install Link = Discord Provided.

2. **Env**: `cp .env.example .env` and fill it. `JWT_SECRET` **must match** the main
   app's `.env`, and `DATABASE_URL` must be the same Neon DB.

3. **DB**: run `migrations.sql` once against the Neon DB (creates `discord_users`,
   `discord_link_codes`).

4. **Install + register + run**
   ```bash
   npm install
   npm run register      # registers slash commands (guild + user install, DM-enabled)
   npm run start         # or: npm run dev
   ```

## Web side — one endpoint you must add to the main app
The bot creates a code; the web app verifies it and links the account. Add a handler
(e.g. `api/discord-link.ts`) called from a Settings → "Link Discord" input, doing:
```ts
// auth = logged-in web user (JWT). body.code = the code from /link
const [row] = await sql`
  SELECT discord_user_id FROM discord_link_codes
  WHERE code = ${code} AND used = false AND expires_at > now()`;
if (!row) return res.status(400).json({ error: "Invalid or expired code" });
await sql`UPDATE discord_users SET linked_user_id = ${auth.userId}::uuid, updated_at = now()
          WHERE id = ${row.discord_user_id}::uuid`;
await sql`UPDATE discord_link_codes SET used = true WHERE code = ${code}`;
```
(Mirrors `telegram-bot` `verifyLinkCode`.)

## Commands (all DM-capable)
- `/link` — connect your web account
- `/balance` — show credits
- `/generate prompt:<text>` — image generation (the one integration point — see
  `src/backend.ts`; extend with `/animate` for video the same way)
- `/help`

## Deploy
Run like `grokrunner.service` — a systemd unit running `npm run start` (tsx), with
the `.env` as `EnvironmentFile`. It's a long-lived gateway connection, not serverless.

## ⚠️ Before you ship: Discord + adult content
GltchRunner is uncensored/NSFW. Discord's ToS restricts sexual content and **bans
adult-AI bots**; age-restricted gating and DM content have specific rules. Resolve
compliance (age verification, content gating, takedown risk) **before** promoting
this — it's the single biggest risk to running GltchRunner on Discord.

## Extending to video
Add an `/animate` command and a `generateVideo()` in `backend.ts` that posts the
WAN/Seedance request (mirror `src/hooks/useGrokApi.ts`), with `i.deferReply()` +
`editReply()` when the (slower) job finishes.

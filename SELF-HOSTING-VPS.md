# 🖥️ Self-Hosting on Your Own Linux VPS (no Docker, no Vercel)

This guide deploys the full app (frontend + `/api/*` backend) as a single Node
process on your own server, with **Neon** still hosting the Postgres database.

Result: zero dependency on Vercel. If Vercel goes down or hits a billing cap,
your users are unaffected.

---

## 1. Requirements

- Ubuntu/Debian VPS (1 vCPU / 1 GB RAM is plenty to start)
- Node.js **20+** (`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs`)
- A domain pointed at the server (e.g. `app.yourdomain.com`)
- Nginx or Caddy in front for TLS
- All the env vars you currently have in Vercel (DATABASE_URL, JWT_SECRET, Stripe keys, R2 keys, Resend, etc.)

---

## 2. Get the code on the server

```bash
git clone <your-repo-url> gltch
cd gltch
npm install      # or: bun install
```

---

## 3. Create `.env`

Copy every env var from your Vercel project settings into a `.env` file at the
repo root. At minimum you need:

```env
# Core
NODE_ENV=production
PORT=3000
JWT_SECRET=...

# Database (keep using Neon — paste the same connection string)
DATABASE_URL=postgres://...

# Storage
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
R2_PUBLIC_URL=...
BLOB_READ_WRITE_TOKEN=...    # only if you still use Vercel Blob

# Email
RESEND_API_KEY=...
RESEND_WEBHOOK_SECRET=...

# Stripe
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

# AI providers
XAI_API_KEY=...
RUNPOD_API_KEY=...
# ...etc

# Admin
ADMIN_EMAIL=you@example.com

# Cron (optional — set to "false" to disable scheduled jobs on this node)
ENABLE_CRON=true
```

The server loads `.env` automatically via Node's built-in `--env-file` flag
(see step 6) or via your process manager.

---

## 4. Build the frontend

```bash
npm run build
```

This produces `dist/` which the server will serve as static files.

---

## 5. Start the server (manual test)

```bash
node --env-file=.env --import tsx server/index.ts
# or simply:
npm run start
```

You should see:

```
[server] Mounted 70+ API routes
[cron] scheduled "0 0 * * *" → /api/cron-reset-daily
[server] Listening on http://0.0.0.0:3000
```

Hit `http://your-server-ip:3000` — the app should load and `/api/auth/login`
should return 400/401 instead of 402.

---

## 6. Run as a systemd service

Create `/etc/systemd/system/gltch.service`:

```ini
[Unit]
Description=GLTCH app server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/gltch
EnvironmentFile=/srv/gltch/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
StandardOutput=append:/var/log/gltch.log
StandardError=append:/var/log/gltch.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gltch
sudo systemctl status gltch
```

---

## 7. Put Nginx (or Caddy) in front for TLS

### Caddy (simplest — auto TLS)

`/etc/caddy/Caddyfile`:

```
app.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

`sudo systemctl reload caddy` — done.

### Nginx (manual certbot)

```nginx
server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/app.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.yourdomain.com/privkey.pem;

    client_max_body_size 60m;     # for image uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;            # for long generations
    }
}
```

---

## 8. Update webhooks

In each provider's dashboard, change the webhook URL from your Vercel domain to:

- **Stripe** → `https://app.yourdomain.com/api/webhook`
- **Resend** → `https://app.yourdomain.com/api/resend-webhook`

---

## 9. Deploying updates

```bash
cd /srv/gltch
git pull
npm install
npm run build
sudo systemctl restart gltch
```

---

## How it works

`server/index.ts` is a small Express app that:

1. Walks the existing `api/` folder and mounts each file as a route
   (e.g. `api/auth/login.ts` → `POST /api/auth/login`). **No handler code
   was changed** — they still use the `VercelRequest`/`VercelResponse`
   signature, which is API-compatible with Express's req/res.
2. Applies the same CORS + security headers that `vercel.json` configured.
3. Serves `dist/` as static files with an SPA fallback.
4. Runs the cron jobs (`/api/cron-*`) locally via `node-cron`.

This means you can run **either** Vercel **or** your VPS from the same
codebase — no fork, no divergence.

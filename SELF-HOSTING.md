# 🔒 GROK_IMAGINE — Private Self-Hosting Guide

Your API key **never leaves your device** — it's stored in localStorage and calls go directly from your browser to `api.x.ai`. Here's how to host this app 100% privately.

---

## 📱 Option 1: iPhone via iSH Terminal

[iSH](https://apps.apple.com/us/app/ish-shell/id1436902243) gives you a Linux shell on iOS.

```bash
# Install dependencies
apk add nodejs npm

# Clone your repo (or copy files via Files app)
git clone <your-repo-url> grok-imagine
cd grok-imagine

# Install and build
npm install
npm run build

# Serve the built files
npx serve dist -l 3000
```

Open Safari → `http://localhost:3000` → Add to Home Screen for the full PWA experience.

> **Tip:** iSH runs Alpine Linux. It's slow to install but works great once running.

---

## 🐳 Option 2: Docker (NAS / Home Server / Any Machine)

### Quick start
```bash
docker compose up -d
```
App runs at `http://<your-ip>:3000`

### Manual Docker build
```bash
docker build -t grok-imagine .
docker run -d -p 3000:80 --name grok-imagine --restart unless-stopped grok-imagine
```

### NAS-Specific Instructions

**Synology NAS:**
1. Install **Container Manager** from Package Center
2. Upload the project folder or clone via SSH
3. Open Container Manager → Project → Create
4. Point to the folder with `docker-compose.yml`
5. Click Build & Run
6. Access at `http://<nas-ip>:3000`

**QNAP NAS:**
1. Install **Container Station** from App Center
2. SSH into NAS and clone the repo
3. Run `docker compose up -d`
4. Access at `http://<nas-ip>:3000`

**Unraid:**
1. Install the **Docker Compose Manager** plugin
2. Add a new stack, paste the `docker-compose.yml` content
3. Build and start the stack
4. Access at `http://<unraid-ip>:3000`

**TrueNAS SCALE:**
1. Go to Apps → Launch Docker Image
2. Or use the built-in shell: clone repo + `docker compose up -d`
3. Access at `http://<truenas-ip>:3000`

---

## 💻 Option 3: Static File Server (Any Computer)

```bash
# Build the app
npm install
npm run build

# Serve with any static server:

# Option A: npx serve (easiest)
npx serve dist -l 3000

# Option B: Python
cd dist && python3 -m http.server 3000

# Option C: PHP
cd dist && php -S 0.0.0.0:3000
```

---

## 🌐 Option 4: LAN Access from Other Devices

After hosting on any machine, access from other devices on the same WiFi:

1. Find your machine's local IP: `hostname -I` or `ifconfig`
2. Open `http://<local-ip>:3000` from any device on the network
3. On iOS: Share → Add to Home Screen for PWA install

---

## 🔐 Option 5: Tailscale / ZeroTier (Secure Remote Access)

For accessing your private instance from anywhere without exposing ports:

```bash
# Install Tailscale on your server
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Your app is now available at:
# http://<tailscale-ip>:3000
# Only devices on your Tailscale network can access it
```

---

## 📲 Installing as PWA (Phone App)

Once the app is running at any URL:

**iOS:** Safari → Share → Add to Home Screen
**Android:** Chrome → Menu (⋮) → Install App / Add to Home Screen

The app will:
- Have its own icon (the cyan neural brain)
- Run fullscreen without browser chrome
- Cache fonts and assets for offline UI loading
- Still need network for xAI API calls

---

## 🛡️ Privacy Summary

| Concern | Status |
|---------|--------|
| API key storage | Browser localStorage only |
| API calls | Direct to api.x.ai, no middleman |
| Server-side code | None — pure static files |
| Telemetry | None |
| Data persistence | All local, clear browser = gone |

Your generated images come from xAI's servers, but the app itself stores nothing remotely.

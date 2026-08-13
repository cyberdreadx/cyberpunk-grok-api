# public-site

Static marketing sites served by **nginx on the API box** — not by Netlify, and
not part of the Vite app. They were living only in `/var/www` with no version
control and no backup, which is why they're mirrored here.

## gltchrunner.com

| | |
|---|---|
| Served from | `/var/www/gltchrunner/` |
| nginx config | `/etc/nginx/sites-available/gltchrunner.com` (symlinked into `sites-enabled`) |
| Contents | one hand-written `index.html`, plus `favicon.ico` and `og-image.png` |

This is the **first** page most visitors see. It is a separate site from
`grokrunner.gltch.app`, which serves the React app from Netlify.

### Deploying a change

The copy in this directory is a mirror, not the live file. To ship an edit:

```sh
sudo cp public-site/gltchrunner.com/index.html /var/www/gltchrunner/index.html
```

No nginx reload is needed for content changes — it's a static file. If the
**config** changes, use `sudo systemctl reload nginx`, never `restart`:
restarting drops the socket that tailscale serve holds on :443.

The two binary assets (`favicon.ico`, `og-image.png`) are not mirrored here;
they're unchanged since June 2026 and live only in `/var/www/gltchrunner/`.

### Routes nginx handles for this domain

- `/s/*` proxies to the API on `127.0.0.1:3000` so share links render their
  OG meta tags.
- `/feed` 302s to the app.
- `/r/<code>` 302s to the app with `?ref=<code>` — referral links pointed at
  the apex domain still attribute.

### Watch out for

Marketing copy here duplicates claims made in the app. When a promise changes,
it has to change in **both** places — the "free credits to start" line outlived
`app_config.free_credits` being switched off on 2026-07-30 by two weeks,
because nothing connects them.

/**
 * Self-hosted Express server for GLTCH.
 *
 * Auto-mounts every Vercel-style handler in /api as a route, serves the built
 * Vite frontend from /dist, and runs the cron jobs locally via node-cron.
 *
 * Run with:  npm run start
 *            (PORT=3000 by default)
 *
 * This file is a drop-in replacement for the Vercel runtime — no app code
 * inside /api had to be changed.
 */

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import cron from "node-cron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "api");
const DIST_DIR = path.join(ROOT, "dist");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Routes whose handlers expect the *raw* request body (signature verification).
const RAW_BODY_ROUTES = new Set<string>(["/api/webhook"]);
// library-purge accepts text/plain: pagehide beacons must avoid CORS preflight.
const TEXT_BODY_ROUTES = new Set<string>(["/api/resend-webhook", "/api/library-purge"]);

/** Walk /api and return { route, file } for each handler. */
function discoverRoutes(): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Skip internal folders/files
      if (entry.name.startsWith("_")) continue;
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}/${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      if (entry.name === "tsconfig.json" || entry.name === "package.json") continue;
      const base = entry.name.replace(/\.(ts|js)$/, "");
      out.push({ route: `${prefix}/${base}`, file: full });
    }
  };
  walk(API_DIR, "/api");
  return out;
}

/** Wrap a Vercel-style handler as an Express RequestHandler. */
function wrapHandler(load: () => Promise<any>) {
  let cached: ((req: any, res: any) => any) | null = null;
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!cached) {
        const mod = await load();
        const h = mod?.default ?? mod?.handler ?? mod;
        if (typeof h !== "function") {
          return res.status(500).json({ error: "Handler is not a function" });
        }
        cached = h;
      }
      // Vercel's req has .query, .body, .cookies, .headers, .method — Express
      // provides all of these. res.status/json/send/end/setHeader are identical.
      await cached!(req, res);
    } catch (err: any) {
      console.error(`[handler:${req.path}]`, err?.stack || err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  };
}

async function main() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  // Security headers (mirrors vercel.json)
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req_is_https(_req)) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
      );
    }
    next();
  });

  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
      maxAge: 86400,
    }),
  );

  app.use(cookieParser());

  // Body parsing — raw for signature-verified webhooks, JSON for everything else.
  app.use((req, res, next) => {
    if (RAW_BODY_ROUTES.has(req.path)) {
      return express.raw({ type: "*/*", limit: "5mb" })(req, res, next);
    }
    if (TEXT_BODY_ROUTES.has(req.path)) {
      return express.text({ type: "*/*", limit: "5mb" })(req, res, next);
    }
    return express.json({ limit: "50mb" })(req, res, (err) => {
      if (err) return next(err);
      express.urlencoded({ extended: true, limit: "50mb" })(req, res, next);
    });
  });

  // --- Vercel rewrites (from vercel.json) -----------------------------------
  app.get("/s/:id", (req, res, next) => {
    req.url = `/api/share-page?id=${encodeURIComponent(req.params.id)}`;
    next();
  });

  // --- Auto-mount /api routes ----------------------------------------------
  const routes = discoverRoutes();
  for (const { route, file } of routes) {
    const loader = () => import(pathToFileURL(file).href);
    // All HTTP methods go to the same handler (Vercel-style)
    app.all(route, wrapHandler(loader));
  }
  console.log(`[server] Mounted ${routes.length} API routes`);

  // --- Static frontend ------------------------------------------------------
  if (fs.existsSync(DIST_DIR)) {
    app.use(
      express.static(DIST_DIR, {
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache");
          } else if (filePath.match(/\.(js|css|woff2?|png|jpg|jpeg|svg|webp)$/)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );

    // SPA fallback — but DO NOT swallow /api/*
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(DIST_DIR, "index.html"));
    });
  } else {
    console.warn(`[server] dist/ not found — run \`npm run build\` first to serve the frontend.`);
  }

  // --- Cron jobs (mirrors vercel.json crons) -------------------------------
  if (process.env.ENABLE_CRON !== "false") {
    registerCron(app);
  }

  app.listen(PORT, HOST, () => {
    console.log(`[server] Listening on http://${HOST}:${PORT}`);
  });
}

function req_is_https(req: Request) {
  return req.secure || (req.headers["x-forwarded-proto"] === "https");
}

function registerCron(_app: express.Express) {
  const base = `http://127.0.0.1:${PORT}`;
  const cronSecret = process.env.CRON_SECRET;
  const hit = async (path: string) => {
    try {
      const res = await fetch(base + path, {
        method: "GET",
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
      });
      console.log(`[cron] ${path} → ${res.status}`);
    } catch (e: any) {
      console.error(`[cron] ${path} failed:`, e?.message);
    }
  };

  const jobs: Array<[string, string]> = [
    ["0 0 * * *", "/api/cron-reset-daily"],
    ["0 */6 * * *", "/api/cron-cleanup-stories"],
    ["0 4 * * 0", "/api/cron-blob-orphans?confirm=1"],
    ["15 4 * * *", "/api/cron-blob-orphans?confirm=1&transient=1"],
    ["30 4 * * *", "/api/cron-r2-orphans?confirm=1"],
    ["*/2 * * * *", "/api/cron-email-campaign"],
    ["10 3 * * *", "/api/cron-xrge-snapshot"],
  ];

  for (const [schedule, path] of jobs) {
    cron.schedule(schedule, () => hit(path), { timezone: "UTC" });
    console.log(`[cron] scheduled "${schedule}" → ${path}`);
  }
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});

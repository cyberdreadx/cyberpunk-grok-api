import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Origins allowed to make CREDENTIALED cross-origin requests. Reflecting any
 * origin alongside Allow-Credentials let any website call this API with the
 * browser's cookies attached (the trusted-device cookie is SameSite=None), so
 * the allowlist is what makes that header safe.
 *
 * Extra origins can be added via CORS_EXTRA_ORIGINS (comma-separated).
 */
const ALLOWED_ORIGIN_SUFFIXES = ["gltch.app", "gltchrunner.com", "grokrunner.com"];
const EXTRA_ORIGINS = (process.env.CORS_EXTRA_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function isAllowedOrigin(origin: string): boolean {
  if (EXTRA_ORIGINS.includes(origin)) return true;
  let host: string;
  let protocol: string;
  try {
    const u = new URL(origin);
    host = u.hostname.toLowerCase();
    protocol = u.protocol;
  } catch {
    return false;
  }
  // Local dev over http is fine; everything else must be https.
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (isLocal) return true;
  if (protocol !== "https:") return false;
  // Exact host or subdomain match only — never a substring match, so
  // "gltch.app.evil.com" does not qualify.
  return ALLOWED_ORIGIN_SUFFIXES.some((d) => host === d || host.endsWith(`.${d}`));
}

export function applyCors(
  req: VercelRequest,
  res: VercelResponse,
  methods: string = "GET, POST, PUT, PATCH, DELETE, OPTIONS",
) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const requestedHeaders = typeof req.headers["access-control-request-headers"] === "string"
    ? req.headers["access-control-request-headers"]
    : "";
  const allowHeaders = requestedHeaders || "Content-Type, Authorization";

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else if (origin) {
    // Unknown origin: still allow anonymous (Bearer-token) API use, but never
    // with credentials.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", allowHeaders);
  res.setHeader("Access-Control-Max-Age", "86400");
}
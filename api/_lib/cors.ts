import type { VercelRequest, VercelResponse } from "@vercel/node";

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

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", allowHeaders);
  res.setHeader("Access-Control-Max-Age", "86400");
}
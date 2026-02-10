/**
 * Netlify Function: download proxy.
 * Fetches media from xAI CDN server-side to bypass CORS, returns it
 * with Content-Disposition: attachment so the browser triggers a real download.
 *
 * Usage: GET /.netlify/functions/download?url=https://vidgen.x.ai/...&filename=video.mp4
 */

import type { Context } from "@netlify/functions";

const ALLOWED_HOSTS = ["vidgen.x.ai", "api.x.ai", "cdn.x.ai"];

export default async (request: Request, _context: Context): Promise<Response> => {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const filename = searchParams.get("filename") || "download";

  if (!url) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate the URL is from a trusted domain
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!ALLOWED_HOSTS.some((h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`))) {
    return new Response(JSON.stringify({ error: "Domain not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream returned ${upstream.status}` }), {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Download failed", detail: err?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

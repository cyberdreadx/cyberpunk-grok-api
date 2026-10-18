import { randomBytes } from "node:crypto";

/**
 * 128 bits from the OS CSPRNG, URL-safe. The media bucket is public and has
 * no listing, so an unguessable key is the only thing keeping someone's
 * generations private — a timestamp plus Math.random()'s 4–6 characters (or
 * nothing, on Vercel Blob, which adds no suffix by default) was not that.
 */
export function secureToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Shared Neon Postgres client for all API routes.
 * Uses @neondatabase/serverless which works in Vercel serverless functions.
 */

import { neon } from "@neondatabase/serverless";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  return neon(url);
}

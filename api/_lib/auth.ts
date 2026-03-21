/**
 * Shared JWT auth helpers for API routes.
 */

import jwt from "jsonwebtoken";
import type { VercelRequest } from "@vercel/node";

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "cyberdreadx@proton.me";

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return secret;
};

export interface JwtPayload {
  userId: string;
  email: string;
}

/** Sign a JWT with 30-day expiry. */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "30d" });
}

/** Verify and decode a JWT. Returns null if invalid. */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

/** Extract JWT payload from an Authorization header. Returns null if missing/invalid. */
export function getUserFromRequest(req: VercelRequest): JwtPayload | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return verifyToken(header.slice(7));
}

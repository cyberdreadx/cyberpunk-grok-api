import jwt from "jsonwebtoken";
import { config } from "./config.js";

/**
 * Mint a short-lived JWT for a linked web user so the bot can call the existing
 * GltchRunner backend AS that user. The payload shape + secret must match the
 * main app's api/_lib/auth.ts (signToken signs { userId, email }). Because we
 * authenticate as the real user, the backend handles credits, gating, RunPod,
 * R2 upload, etc. — no logic is duplicated here.
 */
export function mintUserToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, config.jwtSecret, { expiresIn: "10m" });
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeCaptchaChallenge, signCaptchaToken } from "../_lib/captcha";

/**
 * GET /api/auth/captcha — issues a self-hosted CAPTCHA challenge.
 * Returns { question, token }. Token is a short-lived JWT containing the answer.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { question, answer } = makeCaptchaChallenge();
    const token = signCaptchaToken(answer);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ question, token });
  } catch (e: any) {
    console.error("[captcha]", e.message);
    return res.status(500).json({ error: "Failed to generate challenge" });
  }
}

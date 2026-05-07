import type { VercelRequest, VercelResponse } from "@vercel/node";
import jwt from "jsonwebtoken";

/**
 * Self-hosted CAPTCHA: server generates a simple math/word challenge,
 * signs the answer in a short-lived JWT, and returns the question + token.
 * The signup endpoint validates the token + user-provided answer.
 */

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
}

type Challenge = { question: string; answer: string };

function makeChallenge(): Challenge {
  // Mix of three challenge styles to defeat naive parsers.
  const kind = Math.floor(Math.random() * 3);
  if (kind === 0) {
    const a = 2 + Math.floor(Math.random() * 8);
    const b = 2 + Math.floor(Math.random() * 8);
    return { question: `What is ${a} + ${b}?`, answer: String(a + b) };
  }
  if (kind === 1) {
    const a = 5 + Math.floor(Math.random() * 10);
    const b = 1 + Math.floor(Math.random() * Math.min(a - 1, 8));
    return { question: `What is ${a} - ${b}?`, answer: String(a - b) };
  }
  const words = ["neon", "glitch", "pixel", "cyber", "matrix", "ghost", "vapor", "synth"];
  const w = words[Math.floor(Math.random() * words.length)];
  return { question: `Type the word in reverse: "${w}"`, answer: w.split("").reverse().join("") };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { question, answer } = makeChallenge();
    const token = jwt.sign(
      { a: answer.toLowerCase(), n: Math.random().toString(36).slice(2, 10) },
      getSecret(),
      { expiresIn: "5m" }
    );
    return res.status(200).json({ question, token });
  } catch (e: any) {
    console.error("[captcha]", e.message);
    return res.status(500).json({ error: "Failed to generate challenge" });
  }
}

/** Verify a captcha token against the user's answer. Returns true if valid. */
export function verifyCaptcha(token: string, answer: string): boolean {
  if (!token || !answer) return false;
  try {
    const decoded = jwt.verify(token, getSecret()) as { a?: string };
    if (!decoded?.a) return false;
    return decoded.a === String(answer).trim().toLowerCase();
  } catch {
    return false;
  }
}

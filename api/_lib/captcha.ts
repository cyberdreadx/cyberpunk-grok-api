import jwt from "jsonwebtoken";

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
}

export type Challenge = { question: string; answer: string };

export function makeCaptchaChallenge(): Challenge {
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

export function signCaptchaToken(answer: string): string {
  return jwt.sign(
    { a: answer.toLowerCase(), n: Math.random().toString(36).slice(2, 10) },
    getSecret(),
    { expiresIn: "5m" }
  );
}

/** Verify a captcha token against the user's answer. */
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

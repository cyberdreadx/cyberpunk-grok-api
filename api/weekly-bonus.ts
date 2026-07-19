import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * RETIRED (2026-07-19, earn-only credit overhaul). The automatic weekly
 * 10-credit drop was the largest open faucet during the July farming wave
 * (2,730+ claimers/30d with only email verification required). Free credits
 * now come exclusively from /api/earn (engagement-based).
 * Kept as a 410 stub so old clients get a clear message instead of a 404.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  return res.status(410).json({
    error: "Weekly bonus has been retired. Earn free credits through community engagement — see the EARN panel.",
    retired: true,
  });
}

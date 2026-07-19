import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * RETIRED (2026-07-19, earn-only credit overhaul). The shared secret code
 * leaked beyond Reddit and became a farmable open faucet. Free credits now
 * come exclusively from /api/earn (engagement-based).
 * REDDIT_REWARD_CODE env var is no longer read.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  return res.status(410).json({
    error: "The Reddit code reward has been retired. Earn free credits through community engagement — see the EARN panel.",
    retired: true,
  });
}

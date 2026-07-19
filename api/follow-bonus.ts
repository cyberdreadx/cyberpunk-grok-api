import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * RETIRED (2026-07-19, earn-only credit overhaul). The follow-on-X claim was
 * unverifiable self-attestation (no proof of follow) and pure credit leakage.
 * Free credits now come exclusively from /api/earn (engagement-based).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  return res.status(410).json({
    error: "This bonus has been retired. Earn free credits through community engagement — see the EARN panel.",
    retired: true,
  });
}

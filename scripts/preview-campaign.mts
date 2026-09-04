/**
 * Render a campaign email to a file so it can be read before anyone sends it.
 *
 * Sends nothing. The admin panel's own preview goes through the same
 * getAnnouncementHtmlForCampaign, so what this writes is what would go out.
 *
 *   node --env-file=.env --import tsx scripts/preview-campaign.mts announcement_v56
 */
process.env.RESEND_API_KEY = "";

import { writeFileSync } from "fs";
import {
  getAnnouncementHtmlForCampaign,
  getDefaultSubject,
} from "/home/neon/cyberpunk-grok-api/api/_lib/email-campaign.ts";

const campaign = process.argv[2] || "announcement_v56";
const html = getAnnouncementHtmlForCampaign(campaign);
const subject = getDefaultSubject(campaign);

const out = `/tmp/gltch-work/${campaign}.html`;
writeFileSync(out, html);

console.log(`campaign : ${campaign}`);
console.log(`subject  : ${subject}`);
console.log(`html     : ${html.length} chars -> ${out}`);
// A campaign with no builder falls through to the generic announcement, which
// would silently send last release's copy under this release's subject.
console.log(`resolved : ${html.includes("v5.6") ? "v5.6 builder" : "FELL BACK to the generic announcement"}`);
process.exit(0);

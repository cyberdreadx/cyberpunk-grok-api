import { BotContext } from "../middleware/auth.js";

const HELP = `*GLTCH Bot Commands*

/edit \`prompt\` — AI image edit using Flux 2 Klein (2 credits)
  Attach a photo or reply to a photo with this command.

/video \`prompt\` — AI video generation using WAN 2.2 (5 credits)
  Attach a photo or reply to a photo with this command.

/balance — Show your current credit balance

/buy — Purchase credit packs with Telegram Stars or XRGE

/link — Link your Telegram to an existing GLTCH web account
  Shared credits when linked.

*Holder Program (XRGE):*
\u2022 Hold XRGE to unlock permanent gen discounts + bonus daily credits
\u2022 Tiers: Initiate 1M (+5%) \u2192 Operative 10M (+10%, +2/day) \u2192 Runner 50M (+15%, +5/day, NSFW LoRA) \u2192 Architect 250M (+25%, +10/day, GLTCH PRO)
\u2022 Continuous-hold streak multiplier: \u00d71.25 (30d) / \u00d71.50 (90d) / \u00d72.00 (180d)
\u2022 Check your tier in the web app: Store \u2192 XRGE Bank \u2192 Holder tab
\u2022 Bind your Base wallet from the bank so on-chain XRGE counts toward your tier

*Tips:*
\u2022 Be descriptive in your prompts for best results
\u2022 Images work best at reasonable sizes (no tiny thumbnails)
\u2022 Video generation takes 1-3 minutes`;

export async function helpCommand(ctx: BotContext) {
  await ctx.reply(HELP, { parse_mode: "Markdown" });
}

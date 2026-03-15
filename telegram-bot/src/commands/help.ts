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

*Tips:*
\u2022 Be descriptive in your prompts for best results
\u2022 Images work best at reasonable sizes (no tiny thumbnails)
\u2022 Video generation takes 1-3 minutes`;

export async function helpCommand(ctx: BotContext) {
  await ctx.reply(HELP, { parse_mode: "Markdown" });
}

import { BotContext } from "../middleware/auth.js";

const WELCOME = `\u26A1 *GLTCH Bot* \u26A1

AI image editing & video generation, powered by Flux 2 Klein and WAN 2.2.

*Commands:*
/edit \`prompt\` — Edit an image (attach a photo or reply to one) \u2014 2 cr
/video \`prompt\` — Animate an image to video \u2014 5 cr
/balance — Check your credits
/buy — Purchase credits (Stars or XRGE)
/link — Link to your GLTCH web account
/help — Show this message

Send a photo with a caption starting with \`/edit\` or \`/video\` to get started!`;

export async function startCommand(ctx: BotContext) {
  await ctx.reply(WELCOME, { parse_mode: "Markdown" });
}

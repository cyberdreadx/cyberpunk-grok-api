import { BotContext } from "../middleware/auth.js";
import { createLinkCode } from "../db.js";

export async function linkCommand(ctx: BotContext) {
  if (ctx.tgUser.linkedUserId) {
    await ctx.reply("Your Telegram is already linked to a GLTCH web account. Credits are shared.");
    return;
  }

  const code = await createLinkCode(ctx.tgUser.id);

  await ctx.reply(
    `\uD83D\uDD17 *Link Your Account*\n\n` +
    `Go to your GLTCH web app settings and enter this code:\n\n` +
    `\`${code}\`\n\n` +
    `_This code expires in 10 minutes._\n` +
    `Once linked, your credits will be shared between Telegram and the web app.`,
    { parse_mode: "Markdown" },
  );
}

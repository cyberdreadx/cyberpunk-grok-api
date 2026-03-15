import { BotContext } from "../middleware/auth.js";
import { getCredits } from "../db.js";

export async function balanceCommand(ctx: BotContext) {
  const credits = await getCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId);
  const linked = ctx.tgUser.linkedUserId
    ? "\n_Linked to GLTCH web account \u2014 credits are shared._"
    : "\n_Use /link to connect your GLTCH web account._";

  await ctx.reply(
    `\u26A1 *Your Balance:* ${credits} credits${linked}\n\nUse /buy to get more.`,
    { parse_mode: "Markdown" },
  );
}

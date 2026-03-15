import { Bot } from "grammy";
import { config } from "./config.js";
import { BotContext, authMiddleware } from "./middleware/auth.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { balanceCommand } from "./commands/balance.js";
import { editCommand, videoCommand } from "./commands/generate.js";
import { linkCommand } from "./commands/link.js";
import { buyCommand, handleBuyStarsCallback, handlePreCheckoutQuery, handleSuccessfulPayment } from "./payments/stars.js";
import { handleBuyXrgeCallback, handleXrgePackCallback, handleTxHashMessage } from "./payments/xrge.js";
import { startJobPoller } from "./workflows/poller.js";

const bot = new Bot<BotContext>(config.botToken);

// Ensure every update has a tgUser attached
bot.use(authMiddleware);

// ── Commands ──
bot.command("start", startCommand);
bot.command("help", helpCommand);
bot.command("balance", balanceCommand);
bot.command("buy", buyCommand);
bot.command("link", linkCommand);
bot.command("edit", editCommand);
bot.command("video", videoCommand);

// ── Payments: Telegram Stars ──
bot.on("pre_checkout_query", handlePreCheckoutQuery);
bot.on("message:successful_payment", handleSuccessfulPayment);

// ── Callback queries (inline keyboards) ──
bot.callbackQuery(/^buy_stars_/, handleBuyStarsCallback);
bot.callbackQuery("buy_xrge", handleBuyXrgeCallback);
bot.callbackQuery(/^xrge_pack_/, handleXrgePackCallback);

// ── Photo with caption (shorthand for /edit and /video) ──
bot.on("message:photo", async (ctx) => {
  const caption = ctx.message.caption || "";
  if (caption.startsWith("/edit")) {
    await editCommand(ctx);
  } else if (caption.startsWith("/video")) {
    await videoCommand(ctx);
  }
});

// ── Catch potential XRGE tx hash messages ──
bot.on("message:text", async (ctx) => {
  const handled = await handleTxHashMessage(ctx);
  if (handled) return;
});

// ── Error handler ──
bot.catch((err) => {
  console.error("[bot] Unhandled error:", err.message || err);
});

// ── Start ──
async function main() {
  console.log("[bot] Starting GLTCH Telegram Bot...");

  startJobPoller(bot.api);

  await bot.api.setMyCommands([
    { command: "start", description: "Welcome & info" },
    { command: "edit", description: "AI image edit (2 credits)" },
    { command: "video", description: "AI video generation (5 credits)" },
    { command: "balance", description: "Check your credits" },
    { command: "buy", description: "Buy credits" },
    { command: "link", description: "Link GLTCH web account" },
    { command: "help", description: "Show all commands" },
  ]);

  console.log("[bot] Commands registered. Starting long polling...");
  bot.start();
}

main().catch((err) => {
  console.error("[bot] Fatal error:", err);
  process.exit(1);
});

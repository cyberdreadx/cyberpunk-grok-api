/**
 * Telegram Stars payment flow.
 * Uses the Telegram Payments API with currency "XTR" (Telegram Stars).
 */

import { InlineKeyboard } from "grammy";
import { BotContext } from "../middleware/auth.js";
import { CREDIT_PACKS } from "../config.js";
import { addCredits, recordTransaction } from "../db.js";

export function buildBuyKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const pack of CREDIT_PACKS) {
    kb.text(`${pack.label} — ${pack.credits} cr / ${pack.stars} \u2B50`, `buy_stars_${pack.id}`).row();
  }
  kb.text("\uD83D\uDCB0 Pay with XRGE (30% bonus)", "buy_xrge").row();
  return kb;
}

export async function buyCommand(ctx: BotContext) {
  await ctx.reply(
    "\u26A1 *Buy Credits*\n\nChoose a pack below. Pay with Telegram Stars or XRGE.",
    { parse_mode: "Markdown", reply_markup: buildBuyKeyboard() },
  );
}

export async function handleBuyStarsCallback(ctx: BotContext) {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("buy_stars_")) return;

  const packId = data.replace("buy_stars_", "");
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    await ctx.answerCallbackQuery({ text: "Unknown pack", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  const payload = JSON.stringify({
    userId: ctx.tgUser.id,
    packId: pack.id,
    credits: pack.credits,
  });

  await ctx.replyWithInvoice(
    `${pack.label} Pack — ${pack.credits} Credits`,
    `${pack.credits} GLTCH credits for AI image editing and video generation.`,
    payload,
    "XTR",
    [{ label: `${pack.label} Pack`, amount: pack.stars }],
  );
}

export async function handlePreCheckoutQuery(ctx: BotContext) {
  await ctx.answerPreCheckoutQuery(true);
}

export async function handleSuccessfulPayment(ctx: BotContext) {
  const payment = ctx.message?.successful_payment;
  if (!payment) return;

  let credits: number;
  let packId: string;

  try {
    const payload = JSON.parse(payment.invoice_payload);
    credits = payload.credits;
    packId = payload.packId;
  } catch {
    console.error("[stars] Failed to parse payment payload");
    return;
  }

  await addCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId, credits);
  await recordTransaction({
    telegramUserId: ctx.tgUser.id,
    credits,
    paymentMethod: "stars",
    starsAmount: payment.total_amount,
    telegramPaymentId: payment.telegram_payment_charge_id,
  });

  console.log(`[stars] ${ctx.tgUser.telegramId} bought ${credits} credits (${packId}) for ${payment.total_amount} Stars`);
  await ctx.reply(`\u2705 Payment successful! Added *${credits} credits* to your balance.`, { parse_mode: "Markdown" });
}

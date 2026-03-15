/**
 * XRGE (ERC-20 on Base) payment flow for Telegram bot.
 * Adapted from api/_lib/xrge.ts and api/xrge-checkout.ts.
 */

import { InlineKeyboard } from "grammy";
import { BotContext } from "../middleware/auth.js";
import { config, CREDIT_PACKS, XRGE_BONUS_MULTIPLIER } from "../config.js";
import { getDb, addCredits, recordTransaction } from "../db.js";

// ── Constants ──

const XRGE_CONTRACT = "0x147120faec9277ec02d957584cfcd92b56a24317";
const XRGE_DECIMALS = 18;
const REQUIRED_CONFIRMATIONS = 5;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEXSCREENER_URL = `https://api.dexscreener.com/tokens/v1/base/${XRGE_CONTRACT}`;
const PRICE_CACHE_TTL_MS = 60_000;

let cachedPrice: number | null = null;
let cachedAt = 0;

// ── Price ──

async function fetchXrgePrice(): Promise<number> {
  const now = Date.now();
  if (cachedPrice !== null && now - cachedAt < PRICE_CACHE_TTL_MS) return cachedPrice;

  if (config.xrgeUsdRateOverride) {
    const rate = parseFloat(config.xrgeUsdRateOverride);
    if (!isNaN(rate) && rate > 0) return rate;
  }

  const res = await fetch(DEXSCREENER_URL);
  if (!res.ok) {
    if (cachedPrice !== null) return cachedPrice;
    throw new Error("Failed to fetch XRGE price");
  }
  const pairs = await res.json();
  if (!Array.isArray(pairs) || pairs.length === 0 || !pairs[0].priceUsd) {
    if (cachedPrice !== null) return cachedPrice;
    throw new Error("No XRGE trading pair found");
  }
  const price = parseFloat(pairs[0].priceUsd);
  if (isNaN(price) || price <= 0) {
    if (cachedPrice !== null) return cachedPrice;
    throw new Error("Invalid XRGE price");
  }
  cachedPrice = price;
  cachedAt = now;
  return price;
}

function centsToXrge(cents: number, usdRate: number): string {
  return (cents / 100 / usdRate).toFixed(4);
}

function xrgeToWei(amount: string): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(XRGE_DECIMALS, "0").slice(0, XRGE_DECIMALS);
  return BigInt(whole + frac).toString();
}

function weiToXrge(wei: string): string {
  const padded = wei.padStart(XRGE_DECIMALS + 1, "0");
  const whole = padded.slice(0, padded.length - XRGE_DECIMALS) || "0";
  const frac = padded.slice(padded.length - XRGE_DECIMALS);
  const trimmed = frac.replace(/0+$/, "").padEnd(4, "0");
  return `${whole}.${trimmed}`;
}

// ── RPC ──

async function rpcCall(method: string, params: any[]): Promise<any> {
  const res = await fetch(config.baseRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

// ── Conversation state (in-memory, keyed by telegram user ID) ──

interface PendingXrgeOrder {
  packId: string;
  credits: number;
  bonusCredits: number;
  totalCredits: number;
  xrgeAmount: string;
  depositAddress: string;
  createdAt: number;
}

const pendingOrders = new Map<number, PendingXrgeOrder>();

// ── Handlers ──

export async function handleBuyXrgeCallback(ctx: BotContext) {
  await ctx.answerCallbackQuery();

  if (!config.xrgeDepositAddress) {
    await ctx.reply("XRGE payments are not configured. Please contact support.");
    return;
  }

  const kb = new InlineKeyboard();
  for (const pack of CREDIT_PACKS) {
    const bonus = Math.floor(pack.credits * XRGE_BONUS_MULTIPLIER);
    kb.text(`${pack.label} — ${pack.credits + bonus} cr (${bonus} bonus)`, `xrge_pack_${pack.id}`).row();
  }

  await ctx.reply(
    "\uD83D\uDCB0 *XRGE Credit Packs*\n\n30% bonus on all XRGE purchases! Choose a pack:",
    { parse_mode: "Markdown", reply_markup: kb },
  );
}

export async function handleXrgePackCallback(ctx: BotContext) {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("xrge_pack_")) return;

  await ctx.answerCallbackQuery();

  const packId = data.replace("xrge_pack_", "");
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    await ctx.reply("Unknown pack.");
    return;
  }

  try {
    const usdRate = await fetchXrgePrice();
    const xrgeAmount = centsToXrge(pack.priceCents, usdRate);
    const bonusCredits = Math.floor(pack.credits * XRGE_BONUS_MULTIPLIER);
    const totalCredits = pack.credits + bonusCredits;
    const depositAddress = config.xrgeDepositAddress.toLowerCase();

    pendingOrders.set(ctx.tgUser.telegramId, {
      packId: pack.id,
      credits: pack.credits,
      bonusCredits,
      totalCredits,
      xrgeAmount,
      depositAddress,
      createdAt: Date.now(),
    });

    await ctx.reply(
      `\uD83D\uDCB0 *XRGE Payment — ${pack.label} Pack*\n\n` +
      `Send exactly *${xrgeAmount} XRGE* to:\n\n` +
      `\`${depositAddress}\`\n\n` +
      `You will receive *${totalCredits} credits* (${pack.credits} + ${bonusCredits} bonus).\n\n` +
      `After sending, reply with your transaction hash (0x...).\n` +
      `_This order expires in 30 minutes._`,
      { parse_mode: "Markdown" },
    );
  } catch (err: any) {
    console.error("[xrge] Price fetch error:", err.message);
    await ctx.reply("Could not fetch XRGE price. Please try again later.");
  }
}

export async function handleTxHashMessage(ctx: BotContext): Promise<boolean> {
  const text = ctx.message?.text?.trim();
  if (!text || !text.startsWith("0x") || text.length !== 66) return false;

  const order = pendingOrders.get(ctx.tgUser.telegramId);
  if (!order) return false;

  // Check expiry (30 min)
  if (Date.now() - order.createdAt > 30 * 60 * 1000) {
    pendingOrders.delete(ctx.tgUser.telegramId);
    await ctx.reply("Your XRGE order has expired. Please start a new one with /buy.");
    return true;
  }

  const statusMsg = await ctx.reply("\u23F3 Verifying transaction on Base chain...");

  try {
    const txHash = text.toLowerCase();

    const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);
    if (!receipt) throw new Error("Transaction not found. It may still be pending \u2014 wait a moment and try again.");
    if (receipt.status !== "0x1") throw new Error("Transaction failed on-chain.");

    const latestBlockHex = await rpcCall("eth_blockNumber", []);
    const latestBlock = parseInt(latestBlockHex, 16);
    const txBlock = parseInt(receipt.blockNumber, 16);
    const confirmations = latestBlock - txBlock;

    if (confirmations < REQUIRED_CONFIRMATIONS) {
      throw new Error(`Transaction needs ${REQUIRED_CONFIRMATIONS} confirmations, currently has ${confirmations}. Try again in a minute.`);
    }

    const transferLog = (receipt.logs || []).find((log: any) =>
      log.address?.toLowerCase() === XRGE_CONTRACT.toLowerCase() &&
      log.topics?.[0] === TRANSFER_TOPIC,
    );
    if (!transferLog) throw new Error("No XRGE transfer found in this transaction.");

    const to = "0x" + transferLog.topics[2].slice(26).toLowerCase();
    const amountWei = BigInt(transferLog.data).toString();
    const amountHuman = weiToXrge(amountWei);

    if (to !== order.depositAddress) throw new Error("Transaction was not sent to the correct deposit address.");

    const expectedWei = BigInt(xrgeToWei(order.xrgeAmount));
    const actualWei = BigInt(amountWei);
    const tolerance = expectedWei / 100n;
    if (actualWei < expectedWei - tolerance) {
      throw new Error(`Insufficient amount. Expected ~${order.xrgeAmount} XRGE but received ${amountHuman} XRGE.`);
    }

    // Credit the user
    await addCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId, order.totalCredits);
    await recordTransaction({
      telegramUserId: ctx.tgUser.id,
      credits: order.totalCredits,
      paymentMethod: "xrge",
      xrgeAmount: amountHuman,
      txHash,
    });

    pendingOrders.delete(ctx.tgUser.telegramId);

    console.log(`[xrge] ${ctx.tgUser.telegramId} bought ${order.totalCredits} credits via XRGE tx ${txHash}`);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `\u2705 *Payment verified!*\n\nAdded *${order.totalCredits} credits* (${order.credits} + ${order.bonusCredits} bonus).`,
      { parse_mode: "Markdown" },
    );
  } catch (err: any) {
    console.error("[xrge] Verification error:", err.message);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `\u274C Verification failed: ${err.message}`,
    );
  }

  return true;
}

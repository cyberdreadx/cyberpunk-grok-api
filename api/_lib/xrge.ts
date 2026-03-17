/**
 * XRGE token (ERC-20 on Base) payment verification utilities.
 *
 * Contract: 0x147120faec9277ec02d957584cfcd92b56a24317
 * Chain: Base (Chain ID 8453)
 * Decimals: 18
 */

// ── Constants ─────────────────────────────────────────────────────────────

export const XRGE_CONTRACT = "0x147120faec9277ec02d957584cfcd92b56a24317";
export const XRGE_DECIMALS = 18;
export const REQUIRED_CONFIRMATIONS = 5;

/** ERC-20 Transfer event topic: keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ── Live price feed ───────────────────────────────────────────────────────

const DEXSCREENER_URL = `https://api.dexscreener.com/tokens/v1/base/${XRGE_CONTRACT}`;
const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds

let cachedPrice: number | null = null;
let cachedAt = 0;

/**
 * Fetch the live XRGE/USD price from DexScreener (Aerodrome pair on Base).
 * Results are cached for 60 seconds to stay well within rate limits.
 */
async function fetchXrgePrice(): Promise<number> {
  const now = Date.now();
  if (cachedPrice !== null && now - cachedAt < PRICE_CACHE_TTL_MS) {
    return cachedPrice;
  }

  const res = await fetch(DEXSCREENER_URL);
  if (!res.ok) {
    if (cachedPrice !== null) {
      console.warn("[xrge] DexScreener returned HTTP " + res.status + ", using stale cached price");
      return cachedPrice;
    }
    throw new Error("Failed to fetch XRGE price from DexScreener (HTTP " + res.status + ")");
  }

  const pairs = await res.json();
  if (!Array.isArray(pairs) || pairs.length === 0 || !pairs[0].priceUsd) {
    if (cachedPrice !== null) {
      console.warn("[xrge] DexScreener returned no pairs, using stale cached price");
      return cachedPrice;
    }
    throw new Error("No XRGE trading pair found on DexScreener");
  }

  const price = parseFloat(pairs[0].priceUsd);
  if (isNaN(price) || price <= 0) {
    if (cachedPrice !== null) return cachedPrice;
    throw new Error("Invalid XRGE price from DexScreener: " + pairs[0].priceUsd);
  }

  cachedPrice = price;
  cachedAt = now;
  console.log(`[xrge] Live price: $${price}`);
  return price;
}

// ── Config ────────────────────────────────────────────────────────────────

export async function getXrgeConfig() {
  const depositAddress = process.env.XRGE_DEPOSIT_ADDRESS;
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";

  if (!depositAddress) throw new Error("XRGE_DEPOSIT_ADDRESS not configured");

  // Optional env override takes priority over live feed
  const rateOverride = process.env.XRGE_USD_RATE;
  let usdRate: number;
  if (rateOverride) {
    usdRate = parseFloat(rateOverride);
    if (isNaN(usdRate) || usdRate <= 0) throw new Error("Invalid XRGE_USD_RATE override");
  } else {
    usdRate = await fetchXrgePrice();
  }

  return { depositAddress: depositAddress.toLowerCase(), rpcUrl, usdRate };
}

// ── Price calculation ─────────────────────────────────────────────────────

/** Convert a USD cent amount to XRGE amount (human-readable string). */
export function centsToXrge(cents: number, usdRate: number): string {
  const usd = cents / 100;
  const xrgeAmount = usd / usdRate;
  // Round to 4 decimal places to keep it clean
  return xrgeAmount.toFixed(4);
}

/** Convert a human-readable XRGE string to wei (BigInt-safe string). */
export function xrgeToWei(amount: string): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(XRGE_DECIMALS, "0").slice(0, XRGE_DECIMALS);
  return BigInt(whole + frac).toString();
}

/** Convert wei string to human-readable XRGE. */
export function weiToXrge(wei: string): string {
  const padded = wei.padStart(XRGE_DECIMALS + 1, "0");
  const whole = padded.slice(0, padded.length - XRGE_DECIMALS) || "0";
  const frac = padded.slice(padded.length - XRGE_DECIMALS);
  // Trim trailing zeros but keep at least 4 decimals
  const trimmed = frac.replace(/0+$/, "").padEnd(4, "0");
  return `${whole}.${trimmed}`;
}

// ── On-chain verification ─────────────────────────────────────────────────

interface TransferResult {
  from: string;
  to: string;
  amountWei: string;
  amountHuman: string;
  blockNumber: number;
  confirmations: number;
}

/** Call a JSON-RPC method on Base. */
async function rpcCall(rpcUrl: string, method: string, params: any[]): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as { error?: { message?: string }; result?: unknown };
  if (data.error) throw new Error(`RPC error: ${data.error.message ?? "unknown"}`);
  return data.result;
}

/**
 * Verify an XRGE transfer on Base chain.
 * Returns transfer details if valid, throws if not.
 */
export async function verifyXrgeTransfer(
  txHash: string,
  expectedAmountHuman: string,
  depositAddress: string,
  rpcUrl: string,
): Promise<TransferResult> {
  // Normalize
  txHash = txHash.trim().toLowerCase();
  depositAddress = depositAddress.toLowerCase();

  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    throw new Error("Invalid transaction hash format");
  }

  // Get transaction receipt
  const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) throw new Error("Transaction not found. It may still be pending — wait a moment and try again.");

  // Check success
  if (receipt.status !== "0x1") {
    throw new Error("Transaction failed on-chain");
  }

  // Get current block for confirmation count
  const latestBlockHex = await rpcCall(rpcUrl, "eth_blockNumber", []);
  const latestBlock = parseInt(latestBlockHex, 16);
  const txBlock = parseInt(receipt.blockNumber, 16);
  const confirmations = latestBlock - txBlock;

  if (confirmations < REQUIRED_CONFIRMATIONS) {
    throw new Error(`Transaction needs ${REQUIRED_CONFIRMATIONS} confirmations, currently has ${confirmations}. Try again in a minute.`);
  }

  // Find the ERC-20 Transfer event from the XRGE contract
  const transferLog = (receipt.logs || []).find((log: any) =>
    log.address?.toLowerCase() === XRGE_CONTRACT.toLowerCase() &&
    log.topics?.[0] === TRANSFER_TOPIC
  );

  if (!transferLog) {
    throw new Error("No XRGE transfer found in this transaction. Make sure you sent XRGE tokens (not ETH).");
  }

  // Decode Transfer(address from, address to, uint256 value)
  // Topics: [Transfer sig, from (padded), to (padded)]
  // Data: value (uint256)
  const from = "0x" + transferLog.topics[1].slice(26).toLowerCase();
  const to = "0x" + transferLog.topics[2].slice(26).toLowerCase();
  const amountWei = BigInt(transferLog.data).toString();
  const amountHuman = weiToXrge(amountWei);

  // Verify recipient
  if (to !== depositAddress) {
    throw new Error("This transaction was not sent to the correct deposit address");
  }

  // Verify amount (allow 1% tolerance for rounding)
  const expectedWei = BigInt(xrgeToWei(expectedAmountHuman));
  const actualWei = BigInt(amountWei);
  const tolerance = expectedWei / 100n; // 1%
  const minAcceptable = expectedWei - tolerance;

  if (actualWei < minAcceptable) {
    throw new Error(`Insufficient amount. Expected ~${expectedAmountHuman} XRGE but received ${amountHuman} XRGE`);
  }

  return {
    from,
    to,
    amountWei,
    amountHuman,
    blockNumber: txBlock,
    confirmations,
  };
}

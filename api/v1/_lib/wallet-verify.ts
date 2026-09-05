/**
 * Wallet ownership proof for XRGE holder-tier binding.
 *
 * Binding a wallet grants real money: discounts on every credit purchase, daily
 * credit bonuses, and gated LoRAs. Before this existed, the only thing standing
 * between a user and Architect tier was typing a whale's public address, which is
 * visible to anyone on Basescan.
 *
 * The flow is EIP-4361 (Sign-In with Ethereum) shaped:
 *   1. issueWalletChallenge() mints a single-use nonce and the exact text to sign
 *   2. the wallet signs it (personal_sign — free, no transaction, no approval)
 *   3. consumeWalletChallenge() burns the nonce, verifyWalletSignature() checks it
 *
 * Verification goes through viem's public-client verifyMessage, which covers plain
 * EOAs (ecrecover), deployed smart-contract wallets (ERC-1271) and counterfactual
 * ones (ERC-6492). That last two matter more than usual here: XRGE is on Base,
 * where a large share of wallets are Coinbase Smart Wallet, and a smart-wallet
 * signature is not recoverable with ecrecover at all — a hand-rolled implementation
 * would reject exactly the users most likely to be holders.
 */

import { randomBytes } from "crypto";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { XRGE_CHAIN_ID } from "../../_lib/xrge";

/** How long a user has to sign after requesting the challenge. */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** Shown in the signing prompt; keep in step with the deployed frontend. */
const DOMAIN = "gltch.app";
const URI = "https://grokrunner.gltch.app";

export interface WalletChallenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });
  }
  return cachedClient;
}

/** Normalise to lowercase 0x-prefixed hex, or null if it isn't an address. */
export function normalizeAddress(input: unknown): string | null {
  const clean = String(input ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(clean) ? clean : null;
}

/**
 * The text the user actually sees in their wallet. Deliberately spells out that
 * nothing is being authorised — a signing prompt full of opaque hex is how people
 * get drained, and a holder wallet has real balances in it.
 */
function buildMessage(address: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  return [
    `${DOMAIN} wants you to verify ownership of this wallet:`,
    address,
    ``,
    `Bind this wallet to your GLTCH Runner account so the $XRGE it holds counts`,
    `toward your holder tier.`,
    ``,
    `This signature is free, grants no spending approval, and cannot move any`,
    `tokens. GLTCH will never ask you to sign a transaction to verify a wallet.`,
    ``,
    `URI: ${URI}`,
    `Chain ID: ${XRGE_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}

/**
 * Mint a challenge for (user, address). Any of the user's outstanding challenges
 * are dropped first so a user can't stockpile nonces and reuse an old one against
 * a different address later.
 */
export async function issueWalletChallenge(
  sql: any,
  userId: string,
  address: string,
): Promise<WalletChallenge> {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = buildMessage(address, nonce, issuedAt, expiresAt);

  await sql`DELETE FROM wallet_challenges WHERE user_id = ${userId}`;
  await sql`
    INSERT INTO wallet_challenges (nonce, user_id, address, message, expires_at)
    VALUES (${nonce}, ${userId}, ${address}, ${message}, ${expiresAt.toISOString()})
  `;

  // Opportunistic sweep; there is no cron for this table and it only ever grows
  // by one row per bind attempt.
  sql`DELETE FROM wallet_challenges WHERE expires_at < now() - interval '1 day'`.catch(
    () => {},
  );

  return { nonce, message, expiresAt: expiresAt.toISOString() };
}

/**
 * Burn the challenge and return the message it covered.
 *
 * The UPDATE ... WHERE used_at IS NULL RETURNING is what makes this single-use:
 * two concurrent verifies race on the same row and exactly one comes back with it.
 * Returns null if the nonce is unknown, expired, already spent, or belongs to a
 * different user or address.
 */
export async function consumeWalletChallenge(
  sql: any,
  userId: string,
  address: string,
  nonce: string,
): Promise<string | null> {
  const [row] = await sql`
    UPDATE wallet_challenges
       SET used_at = now()
     WHERE nonce      = ${nonce}
       AND user_id    = ${userId}
       AND address    = ${address}
       AND used_at   IS NULL
       AND expires_at > now()
    RETURNING message
  `;
  return row?.message ?? null;
}

/**
 * Does `signature` prove control of `address` over `message`?
 *
 * Never throws — an RPC hiccup during the ERC-1271 on-chain call must read as
 * "not proven" rather than crashing the bind, and must never read as success.
 */
export async function verifyWalletSignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  if (!/^0x[a-fA-F0-9]+$/.test(signature) || signature.length < 132) return false;
  try {
    return await getClient().verifyMessage({
      address: address as Address,
      message,
      signature: signature as Hex,
    });
  } catch (err: any) {
    console.warn("[wallet-verify] verifyMessage failed:", err?.message);
    return false;
  }
}

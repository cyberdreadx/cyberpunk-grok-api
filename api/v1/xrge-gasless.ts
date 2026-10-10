/**
 * Gasless XRGE deposits: the user signs an EIP-2612 permit (free, no ETH), and
 * our gas payer submits permit() + transferFrom(user → deposit address) and
 * pays the gas. See api/_lib/gas-payer.ts.
 *
 * GET  /api/v1/xrge-gasless?address=0x…
 *   → what the wallet needs to sign: spender, permit nonce, deadline, plus the
 *     wallet's XRGE/ETH balances and the minimum deposit.
 * POST /api/v1/xrge-gasless  { owner, value, deadline, signature }
 *   → { txHash } once the transfer is mined. It's credited after 5
 *     confirmations, here in the background and by the client calling
 *     /api/v1/xrge-deposit with the hash (whichever lands first; the other
 *     sees "already credited").
 *
 * Auth: Authorization: Bearer JWT.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAddress, parseSignature, verifyTypedData, type Address, type Hex } from "viem";
import { getDb } from "../_lib/db";
import { getUserFromRequest } from "../_lib/auth";
import { checkRateLimit } from "../_lib/ratelimit";
import { getXrgeConfig, REQUIRED_CONFIRMATIONS } from "../_lib/xrge";
import { assertDepositWallet, creditXrgeDeposit, DepositError } from "../_lib/xrge-deposit-credit";
import {
  GAS_PAYER_MIN_WEI,
  PERMIT_TYPES,
  XRGE_ABI,
  readXrge,
  XRGE_ADDRESS,
  XRGE_PERMIT_DOMAIN,
  getGasPayer,
  publicClient,
  serialized,
} from "../_lib/gas-payer";

export const config = { maxDuration: 90 };

const DEADLINE_SECONDS = 20 * 60;

/** Smallest gasless deposit, in USD, so dust deposits can't drain the gas payer. */
function minDepositUsd(): number {
  const v = parseFloat(process.env.GASLESS_MIN_USD || "");
  return Number.isFinite(v) && v > 0 ? v : 1;
}

async function minDepositWei(usdRate: number): Promise<bigint> {
  const xrge = Math.ceil(minDepositUsd() / usdRate);
  return BigInt(xrge) * 10n ** 18n;
}

async function gasPayerReady(): Promise<boolean> {
  const gp = getGasPayer();
  if (!gp) return false;
  const bal = await publicClient.getBalance({ address: gp.account.address });
  return bal >= GAS_PAYER_MIN_WEI;
}

/** Credit in the background once the transfer has enough confirmations. */
function creditWhenConfirmed(userId: string, txHash: Hex) {
  void (async () => {
    try {
      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: REQUIRED_CONFIRMATIONS + 1,
        timeout: 5 * 60_000,
      });
      await creditXrgeDeposit(getDb(), userId, txHash, { gasless: true });
    } catch (err: any) {
      // "already credited" just means the client got there first.
      if (!/already been credited/.test(err?.message || "")) {
        console.error(`[xrge-gasless] background credit failed for ${txHash}:`, err?.message);
      }
    }
  })();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const address = String(req.query.address || "");
    if (!isAddress(address)) return res.status(400).json({ error: "Invalid wallet address" });
    try {
      const gp = getGasPayer();
      const { usdRate } = await getXrgeConfig();
      const [nonce, walletXrgeWei, walletEthWei, available, minWei] = await Promise.all([
        readXrge("nonces", [address as Address]),
        readXrge("balanceOf", [address as Address]),
        publicClient.getBalance({ address: address as Address }),
        gasPayerReady(),
        minDepositWei(usdRate),
      ]);
      return res.status(200).json({
        available,
        spender: gp?.account.address ?? null,
        nonce: nonce.toString(),
        deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
        domain: XRGE_PERMIT_DOMAIN,
        walletXrgeWei: walletXrgeWei.toString(),
        walletEthWei: walletEthWei.toString(),
        minDepositWei: minWei.toString(),
      });
    } catch (err: any) {
      console.error("[xrge-gasless] GET", err?.message);
      return res.status(503).json({ error: "Couldn't reach Base right now. Try again in a minute." });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  const { owner, value, deadline, signature } = req.body || {};
  if (!isAddress(owner || "")) return res.status(400).json({ error: "Invalid wallet address" });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return res.status(400).json({ error: "Invalid signature" });
  }
  let valueWei: bigint;
  let deadlineSec: bigint;
  try {
    valueWei = BigInt(value);
    deadlineSec = BigInt(deadline);
  } catch {
    return res.status(400).json({ error: "Invalid amount or deadline" });
  }
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (deadlineSec < nowSec + 60n || deadlineSec > nowSec + BigInt(DEADLINE_SECONDS) + 300n) {
    return res.status(400).json({ error: "This signature has expired. Start the deposit again." });
  }

  const gp = getGasPayer();
  if (!gp) return res.status(503).json({ error: "Gasless deposits aren't set up yet. Send XRGE from your wallet instead." });

  const sql = getDb();
  // Set once transferFrom is broadcast: from then on the XRGE may have moved,
  // so any later error must still lead to the deposit being credited.
  let sentHash: Hex | null = null;
  const ownerAddr = (owner as string).toLowerCase() as Address;

  try {
    const { allowed } = await checkRateLimit(`user:${auth.userId}`, "xrge-gasless", { max: 6, windowSeconds: 3600 });
    if (!allowed) return res.status(429).json({ error: "Too many gasless deposits this hour. Try again later, or send XRGE from your wallet." });

    const { depositAddress, usdRate } = await getXrgeConfig();
    const minWei = await minDepositWei(usdRate);
    if (valueWei < minWei) {
      return res.status(400).json({ error: `The minimum gasless deposit is ${(minWei / 10n ** 18n).toLocaleString("en-US")} XRGE (about $${minDepositUsd()}).` });
    }

    // Check everything that would make the on-chain calls fail before spending gas.
    const nonce = await readXrge("nonces", [ownerAddr]);
    const message = { owner: ownerAddr, spender: gp.account.address, value: valueWei, nonce, deadline: deadlineSec };
    const validSig = await verifyTypedData({
      address: ownerAddr,
      domain: XRGE_PERMIT_DOMAIN,
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message,
      signature: signature as Hex,
    });
    if (!validSig) return res.status(400).json({ error: "The signature doesn't match this wallet. Start the deposit again." });

    const balance = await readXrge("balanceOf", [ownerAddr]);
    if (balance < valueWei) return res.status(400).json({ error: "Your wallet doesn't hold that much XRGE." });

    // Before moving any tokens: the wallet must be (or become) this account's.
    await assertDepositWallet(sql, auth.userId, ownerAddr);

    if (!(await gasPayerReady())) {
      console.error("[xrge-gasless] gas payer is out of ETH:", gp.account.address);
      return res.status(503).json({ error: "Gasless deposits are paused right now. Send XRGE from your wallet instead." });
    }

    const txHash = await serialized(async () => {
      const allowance = await readXrge("allowance", [ownerAddr, gp.account.address]);
      if (allowance < valueWei) {
        const { v, r, s, yParity } = parseSignature(signature as Hex);
        const { request } = await publicClient.simulateContract({
          account: gp.account,
          address: XRGE_ADDRESS,
          abi: XRGE_ABI,
          functionName: "permit",
          args: [ownerAddr, gp.account.address, valueWei, deadlineSec, Number(v ?? BigInt(yParity + 27)), r, s],
        });
        const permitHash = await gp.wallet.writeContract(request);
        const permitReceipt = await publicClient.waitForTransactionReceipt({ hash: permitHash });
        if (permitReceipt.status !== "success") throw new Error("permit reverted");
      }
      const { request } = await publicClient.simulateContract({
        account: gp.account,
        address: XRGE_ADDRESS,
        abi: XRGE_ABI,
        functionName: "transferFrom",
        args: [ownerAddr, depositAddress as Address, valueWei],
      });
      const hash = await gp.wallet.writeContract(request);
      sentHash = hash;
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("transferFrom reverted");
      return hash;
    });

    console.log(`[xrge-gasless] ${ownerAddr} → deposit ${valueWei} wei for user ${auth.userId} (tx ${txHash})`);
    creditWhenConfirmed(auth.userId, txHash);
    return res.status(200).json({ txHash });
  } catch (err: any) {
    if (err instanceof DepositError) return res.status(err.status).json({ error: err.message });
    if (sentHash) {
      console.error(`[xrge-gasless] error after broadcast (${sentHash}):`, err?.shortMessage || err?.message);
      creditWhenConfirmed(auth.userId, sentHash);
      return res.status(200).json({ txHash: sentHash });
    }
    console.error("[xrge-gasless] POST", err?.shortMessage || err?.message);
    return res.status(502).json({ error: "The deposit couldn't be sent. Nothing left your wallet. Try again, or send XRGE from your wallet instead." });
  }
}

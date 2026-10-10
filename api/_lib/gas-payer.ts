/**
 * Gas payer for gasless XRGE deposits.
 *
 * XRGE is an ERC-20 with EIP-2612 permit (OpenZeppelin, domain "RougeCoin" v1).
 * A user signs a permit off-chain (free, no ETH needed) allowing this wallet to
 * move exactly the deposit amount; this wallet then submits permit() and
 * transferFrom(user → XRGE_DEPOSIT_ADDRESS) and pays the Base gas (well under a
 * cent each). The tokens never touch this wallet, so it only ever holds a few
 * dollars of ETH. Key: GAS_PAYER_PRIVATE_KEY in .env.
 *
 * Sends are serialized in-process so concurrent deposits can't race on nonces
 * (the API runs as one process).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { XRGE_CONTRACT } from "./xrge";

export const XRGE_ADDRESS = XRGE_CONTRACT as Address;

export const XRGE_PERMIT_DOMAIN = {
  name: "RougeCoin",
  version: "1",
  chainId: base.id,
  verifyingContract: XRGE_ADDRESS,
} as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const XRGE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
]);

/** Below this much ETH the gas payer stops taking gasless deposits. */
export const GAS_PAYER_MIN_WEI = 200_000_000_000_000n; // 0.0002 ETH ≈ 100+ deposits

export const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
});

let cached: { account: ReturnType<typeof privateKeyToAccount>; wallet: ReturnType<typeof createWalletClient> } | null = null;

/** The gas payer account, or null when GAS_PAYER_PRIVATE_KEY isn't set. */
export function getGasPayer() {
  if (cached) return cached;
  const key = process.env.GAS_PAYER_PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });
  cached = { account, wallet };
  return cached;
}

let queue: Promise<unknown> = Promise.resolve();

/** Run `fn` after every earlier gas-payer send has finished. */
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Read a uint256 view from the XRGE contract. Wrapped because viem's
 * readContract parameter type demands `authorizationList` under this
 * project's tsconfig; all three reads used here return uint256.
 */
export async function readXrge(
  functionName: "balanceOf" | "nonces" | "allowance",
  args: readonly Address[],
): Promise<bigint> {
  return (await publicClient.readContract({ address: XRGE_ADDRESS, abi: XRGE_ABI, functionName, args } as any)) as bigint;
}

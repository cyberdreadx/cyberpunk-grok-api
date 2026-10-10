/**
 * Minimal EIP-1193 wallet connection for proving ownership of a Base address.
 *
 * Deliberately dependency-free: the only thing the holder-tier flow needs is
 * eth_requestAccounts + personal_sign, and pulling in wagmi/WalletConnect for
 * that would add a bundle and a project ID for no extra capability. The tradeoff
 * is that this only sees an *injected* provider — desktop extensions and wallet
 * in-app browsers. A mobile PWA or plain mobile Safari has no injected provider,
 * so those users get told to open the site inside their wallet instead. Adding
 * WalletConnect later would remove that caveat without changing this contract.
 */

export interface WalletChallenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface SignedBinding {
  address: string;
  nonce: string;
  signature: string;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function getProvider(): Eip1193Provider | null {
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return injected ?? null;
}

export function hasInjectedWallet(): boolean {
  return getProvider() !== null;
}

/** True for phones/tablets, where "install an extension" is not useful advice. */
export function isMobile(): boolean {
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Deep link that reopens the current page inside a wallet's own browser. */
export function walletDeepLink(kind: "metamask" | "coinbase"): string {
  const host = window.location.host + window.location.pathname;
  return kind === "metamask"
    ? `https://metamask.app.link/dapp/${host}`
    : `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(window.location.href)}`;
}

/** personal_sign wants hex; wallets decode it back to UTF-8 for display. */
function toHex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** EIP-1193 rejection. 4001 is the user dismissing the prompt, which is not an error. */
function isUserRejection(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  return code === 4001 || /user rejected|denied/i.test((err as Error)?.message || "");
}

/**
 * Connect, fetch a challenge for the connected address, and sign it.
 *
 * `fetchChallenge` is injected rather than called directly so this file stays
 * free of API/auth concerns and can be tested without a server.
 */
export async function connectAndSign(
  fetchChallenge: (address: string) => Promise<WalletChallenge>,
): Promise<SignedBinding> {
  const provider = getProvider();
  if (!provider) {
    throw new Error(
      isMobile()
        ? "No wallet detected. Open grokrunner.gltch.app inside your wallet app's browser to verify."
        : "No wallet detected. Install MetaMask, Coinbase Wallet, or Rabby, then try again.",
    );
  }

  let address: string;
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.length) throw new Error("No account returned by wallet");
    address = accounts[0].toLowerCase();
  } catch (err) {
    throw new Error(
      isUserRejection(err) ? "Wallet connection cancelled" : (err as Error).message,
    );
  }

  // The challenge is minted for this exact address, so a wallet that switches
  // accounts mid-flow fails server-side rather than binding the wrong one.
  const challenge = await fetchChallenge(address);

  try {
    const signature = (await provider.request({
      method: "personal_sign",
      params: [toHex(challenge.message), address],
    })) as string;
    return { address, nonce: challenge.nonce, signature };
  } catch (err) {
    throw new Error(
      isUserRejection(err)
        ? "Signature cancelled — the wallet stays unbound"
        : (err as Error).message,
    );
  }
}

// ── Deposits ──────────────────────────────────────────────────────────────

const BASE_CHAIN_HEX = "0x2105"; // 8453

function requireProvider(): Eip1193Provider {
  const provider = getProvider();
  if (!provider) {
    throw new Error(
      isMobile()
        ? "No wallet detected. Open this page inside your wallet app's browser (Base, Coinbase Wallet, MetaMask) to deposit."
        : "No wallet detected. Install a wallet extension like Coinbase Wallet, MetaMask, or Rabby, then try again.",
    );
  }
  return provider;
}

/** Ask the wallet for its account. Returns the lowercased address. */
export async function connectWallet(): Promise<string> {
  const provider = requireProvider();
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.length) throw new Error("No account returned by wallet");
    return accounts[0].toLowerCase();
  } catch (err) {
    throw new Error(isUserRejection(err) ? "Wallet connection cancelled" : (err as Error).message);
  }
}

/** Switch the wallet to Base, adding the network first if the wallet doesn't know it. */
async function ensureBase(provider: Eip1193Provider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === BASE_CHAIN_HEX) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_HEX }] });
  } catch (err) {
    if ((err as { code?: number })?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BASE_CHAIN_HEX,
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
      return;
    }
    throw new Error(isUserRejection(err) ? "Switch your wallet to the Base network to deposit" : (err as Error).message);
  }
}

export interface PermitRequest {
  owner: string;
  spender: string;
  value: string; // wei
  nonce: string;
  deadline: number;
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
}

/**
 * Sign an EIP-2612 permit for a gasless deposit. This is a signature, not a
 * transaction: it costs nothing and needs no ETH.
 */
export async function signXrgePermit(p: PermitRequest): Promise<string> {
  const provider = requireProvider();
  await ensureBase(provider);
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    domain: p.domain,
    message: { owner: p.owner, spender: p.spender, value: p.value, nonce: p.nonce, deadline: String(p.deadline) },
  };
  try {
    return (await provider.request({
      method: "eth_signTypedData_v4",
      params: [p.owner, JSON.stringify(typedData)],
    })) as string;
  } catch (err) {
    throw new Error(isUserRejection(err) ? "Signature cancelled. Nothing was sent." : (err as Error).message);
  }
}

/** Send an ordinary XRGE transfer from the wallet (the wallet pays the gas). Returns the tx hash. */
export async function sendXrgeTransfer(from: string, token: string, to: string, valueWei: string): Promise<string> {
  const provider = requireProvider();
  await ensureBase(provider);
  // transfer(address,uint256)
  const data =
    "0xa9059cbb" +
    to.toLowerCase().replace(/^0x/, "").padStart(64, "0") +
    BigInt(valueWei).toString(16).padStart(64, "0");
  try {
    return (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to: token, data, value: "0x0" }],
    })) as string;
  } catch (err) {
    throw new Error(isUserRejection(err) ? "Transfer cancelled. Nothing was sent." : (err as Error).message);
  }
}

/** "1,234.5" / "1234.5" → wei string. Returns null for anything that isn't a positive amount. */
export function xrgeToWei(amount: string): string | null {
  const clean = amount.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,18})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  const wei = BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0") || "0");
  return wei > 0n ? wei.toString() : null;
}

/** Wei string → whole XRGE (rounded down), for display. */
export function weiToWholeXrge(wei: string): number {
  return Number(BigInt(wei) / 10n ** 18n);
}

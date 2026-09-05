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

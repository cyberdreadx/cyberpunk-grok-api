/** Public XRGE token info for UI (matches api/_lib/xrge.ts). */
export const XRGE_CONTRACT = "0x147120faec9277ec02d957584cfcd92b56a24317";
export const XRGE_CHAIN_NAME = "Base";
export const XRGE_CHAIN_ID = 8453;

/** Where users can swap / see the pair (human-readable). */
export const XRGE_DEXSCREENER_URL = `https://dexscreener.com/base/${XRGE_CONTRACT}`;

export function basescanAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}

export function basescanTxUrl(txHash: string): string {
  return `https://basescan.org/tx/${txHash}`;
}

/**
 * Display helpers for the web3 edition, where prices and balances are in XRGE.
 * XRGE amounts are large (one credit is ~15k XRGE), so they're shown short.
 */

export function formatXrge(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

/** "3 credits" → "≈44k XRGE" when a per-credit price is known. */
export function creditsAsXrge(credits: number, xrgePerCredit: number | null | undefined): string {
  if (!xrgePerCredit) return "— XRGE";
  return `${formatXrge(Math.ceil(credits * xrgePerCredit))} XRGE`;
}

/* The current XRGE-per-credit price, kept here by useCredits so cost labels
   anywhere can show XRGE without each one fetching the quote. */
let currentXrgePerCredit: number | null = null;
export function setCurrentXrgePerCredit(v: number | null) { currentXrgePerCredit = v; }

/** A cost in the edition's currency: "3 cr" on Runner, "44k XRGE" on web3. */
export function costText(credits: number, isWeb3Edition: boolean): string {
  return isWeb3Edition ? creditsAsXrge(credits, currentXrgePerCredit) : `${credits} cr`;
}

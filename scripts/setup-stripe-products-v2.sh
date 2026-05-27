#!/usr/bin/env bash
# ============================================================
# v2 pricing — repriced to absorb 17.5% Stripe loan deduction
# AND flip subscriptions to per-generation discounts (no monthly credits).
#
# DEPRECATED for subscriptions — v3 ladder is $9/$19/$39/$79 (CASUAL→POWER USER).
# Use setup-stripe-sub-prices-v3.ts or setup-stripe-products-v3.sh for subs only.
# This script still valid if you need to recreate credit-pack price IDs.
#
# Usage:
#   bash scripts/setup-stripe-products-v2.sh           # test
#   bash scripts/setup-stripe-products-v2.sh --live    # production
#
# Prints env vars to paste into Vercel project settings.
# ============================================================

set -euo pipefail

MODE="test"
[[ "${1:-}" == "--live" ]] && MODE="live"
STRIPE_FLAGS=""
[[ "$MODE" == "live" ]] && STRIPE_FLAGS="--live"
echo "=== ${MODE^^} MODE ==="

resolve_stripe_bin() {
  # Prefer a normal PATH lookup first.
  local bin=""
  bin="$(command -v stripe 2>/dev/null || true)"
  [[ -n "$bin" ]] && { echo "$bin"; return 0; }
  bin="$(command -v stripe.exe 2>/dev/null || true)"
  [[ -n "$bin" ]] && { echo "$bin"; return 0; }

  # On Git Bash / MSYS, WinGet installs often aren't on the bash PATH.
  # Try Windows' where.exe, then convert to a POSIX path if possible.
  if command -v where.exe >/dev/null 2>&1; then
    local win_path=""
    win_path="$(where.exe stripe 2>/dev/null | head -n 1 || true)"
    if [[ -n "$win_path" ]]; then
      if command -v cygpath >/dev/null 2>&1; then
        bin="$(cygpath -u "$win_path")"
      else
        # Best-effort fallback: C:\foo\bar -> /c/foo/bar
        bin="$(printf '%s' "$win_path" | sed -E 's#^([A-Za-z]):#/\L\\1#; s#\\\\#/#g')"
      fi
      [[ -n "$bin" ]] && { echo "$bin"; return 0; }
    fi
  fi

  return 1
}

STRIPE_BIN="$(resolve_stripe_bin || true)"
if [[ -z "${STRIPE_BIN:-}" ]]; then
  echo "ERROR: Stripe CLI not found in this shell."
  echo "Install Stripe CLI and/or ensure 'stripe' is on PATH."
  exit 1
fi

STRIPE_AUTH_FLAGS=()
# Optional: allow overriding the API key for this script run (useful for live mode).
# Example (PowerShell): $env:STRIPE_API_KEY="sk_live_..."; bash scripts/setup-stripe-products-v2.sh --live
if [[ -n "${STRIPE_API_KEY:-}" ]]; then
  STRIPE_AUTH_FLAGS=(--api-key "$STRIPE_API_KEY")
fi

create_price() {
  local name="$1" amount="$2" interval="$3" meta="$4"
  local args=(prices create $STRIPE_FLAGS --currency usd --unit-amount "$amount"
    -d "product_data[name]=$name")
  [[ -n "$interval" ]] && args+=(-d "recurring[interval]=$interval")
  while IFS='=' read -r k v; do
    [[ -n "$k" ]] && args+=(-d "product_data[metadata][$k]=$v")
  done <<< "$meta"

  local out=""
  if ! out="$("$STRIPE_BIN" "${STRIPE_AUTH_FLAGS[@]}" "${args[@]}" 2>&1)"; then
    echo "" >&2
    echo "ERROR: Stripe CLI call failed while creating price for: $name" >&2
    echo "$out" >&2
    return 1
  fi

  local id=""
  id="$(printf '%s' "$out" | grep -o '\"id\": \"[^\"]*\"' | head -1 | cut -d'"' -f4 || true)"
  if [[ -z "$id" ]]; then
    echo "" >&2
    echo "ERROR: Could not parse price id from Stripe response for: $name" >&2
    echo "$out" >&2
    return 1
  fi

  printf '%s\n' "$id"
}

echo ""
echo "── One-time credit packs ──"
STARTER=$(create_price    "Starter Pack (75 Credits)"     699   ""      "type=pack
credits=75")
PRO=$(create_price        "Pro Pack (240 Credits)"        1899  ""      "type=pack
credits=240")
MEGA=$(create_price       "Mega Pack (600 Credits)"       4299  ""      "type=pack
credits=600")
ULTRA=$(create_price      "Ultra Pack (2600 Credits)"     17999 ""      "type=pack
credits=2600")
ENTERPRISE=$(create_price "Enterprise Pack (5400 Cr)"     35999 ""      "type=pack
credits=5400")

echo ""
echo "── Monthly subscriptions (discount-based) ──"
SUB_BASIC=$(create_price   "Basic Monthly (15% OFF)"   799   month "type=subscription
tier=basic
discount_pct=15
credits_per_month=0")
SUB_PREMIUM=$(create_price "Premium Monthly (30% OFF)" 1999  month "type=subscription
tier=premium
discount_pct=30
credits_per_month=0")
SUB_PRO=$(create_price     "Pro Monthly (50% OFF)"     5999  month "type=subscription
tier=pro
discount_pct=50
credits_per_month=0")
SUB_ELITE=$(create_price   "Elite Monthly (70% OFF)"   19999 month "type=subscription
tier=elite
discount_pct=70
credits_per_month=0")

echo ""
echo "── Yearly subscriptions ──"
SUB_BASIC_Y=$(create_price   "Basic Yearly (15% OFF)"   8438   year "type=subscription
tier=basic-yearly
discount_pct=15
credits_per_month=0")
SUB_PREMIUM_Y=$(create_price "Premium Yearly (30% OFF)" 21108  year "type=subscription
tier=premium-yearly
discount_pct=30
credits_per_month=0")
SUB_PRO_Y=$(create_price     "Pro Yearly (50% OFF)"     63348  year "type=subscription
tier=pro-yearly
discount_pct=50
credits_per_month=0")
SUB_ELITE_Y=$(create_price   "Elite Yearly (70% OFF)"   211188 year "type=subscription
tier=elite-yearly
discount_pct=70
credits_per_month=0")

cat <<EOF

============================================
Paste these into Vercel env (Production):

STRIPE_PRICE_STARTER=$STARTER
STRIPE_PRICE_PRO=$PRO
STRIPE_PRICE_MEGA=$MEGA
STRIPE_PRICE_ULTRA=$ULTRA
STRIPE_PRICE_ENTERPRISE=$ENTERPRISE

STRIPE_PRICE_SUB_BASIC=$SUB_BASIC
STRIPE_PRICE_SUB_PREMIUM=$SUB_PREMIUM
STRIPE_PRICE_SUB_PRO=$SUB_PRO
STRIPE_PRICE_SUB_ELITE=$SUB_ELITE

STRIPE_PRICE_SUB_BASIC_YEARLY=$SUB_BASIC_Y
STRIPE_PRICE_SUB_PREMIUM_YEARLY=$SUB_PREMIUM_Y
STRIPE_PRICE_SUB_PRO_YEARLY=$SUB_PRO_Y
STRIPE_PRICE_SUB_ELITE_YEARLY=$SUB_ELITE_Y
============================================
EOF

#!/usr/bin/env bash
# ============================================================
# v3 subscription pricing — CASUAL / REGULAR / HOBBYIST / POWER USER
#   $9 / $19 / $39 / $79 monthly · yearly @ 12% off
#
# Credit packs unchanged. Creates subscription prices only (8 IDs).
# TypeScript alternative (cross-platform): setup-stripe-sub-prices-v3.ts
#
# Usage:
#   bash scripts/setup-stripe-products-v3.sh           # test
#   bash scripts/setup-stripe-products-v3.sh --live    # production
#
# Prints env vars to paste into Vercel → preview at /admin/stripe-prices
# ============================================================

set -euo pipefail

MODE="test"
[[ "${1:-}" == "--live" ]] && MODE="live"
STRIPE_FLAGS=""
[[ "$MODE" == "live" ]] && STRIPE_FLAGS="--live"
echo "=== ${MODE^^} MODE — subscription prices v3 ==="

resolve_stripe_bin() {
  local bin=""
  bin="$(command -v stripe 2>/dev/null || true)"
  [[ -n "$bin" ]] && { echo "$bin"; return 0; }
  bin="$(command -v stripe.exe 2>/dev/null || true)"
  [[ -n "$bin" ]] && { echo "$bin"; return 0; }

  if command -v where.exe >/dev/null 2>&1; then
    local win_path=""
    win_path="$(where.exe stripe 2>/dev/null | head -n 1 || true)"
    if [[ -n "$win_path" ]]; then
      if command -v cygpath >/dev/null 2>&1; then
        bin="$(cygpath -u "$win_path")"
      else
        bin="$(printf '%s' "$win_path" | sed -E 's#^([A-Za-z]):#/\L\\1#; s#\\\\#/#g')"
      fi
      [[ -n "$bin" ]] && { echo "$bin"; return 0; }
    fi
  fi
  return 1
}

STRIPE_BIN="$(resolve_stripe_bin || true)"
if [[ -z "${STRIPE_BIN:-}" ]]; then
  echo "ERROR: Stripe CLI not found. Use setup-stripe-sub-prices-v3.ts instead, or install Stripe CLI."
  exit 1
fi

STRIPE_AUTH_FLAGS=()
if [[ -n "${STRIPE_API_KEY:-}" ]]; then
  STRIPE_AUTH_FLAGS=(--api-key "$STRIPE_API_KEY")
fi

create_price() {
  local name="$1" amount="$2" interval="$3" meta="$4"
  local args=(prices create $STRIPE_FLAGS --currency usd --unit-amount "$amount"
    -d "product_data[name]=$name" -d "recurring[interval]=$interval")
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
echo "── Monthly subscriptions ──"
SUB_BASIC=$(create_price   "Casual Monthly (15% OFF)"     900   month "type=subscription
tier=basic
discount_pct=15
credits_per_month=0
pricing_version=v3")
SUB_PREMIUM=$(create_price "Regular Monthly (30% OFF)"   1900  month "type=subscription
tier=premium
discount_pct=30
credits_per_month=0
pricing_version=v3")
SUB_PRO=$(create_price     "Hobbyist Monthly (50% OFF)"  3900  month "type=subscription
tier=pro
discount_pct=50
credits_per_month=0
pricing_version=v3")
SUB_ELITE=$(create_price   "Power User Monthly (70% OFF)" 7900 month "type=subscription
tier=elite
discount_pct=70
credits_per_month=0
pricing_version=v3")

echo ""
echo "── Yearly subscriptions (12% off) ──"
SUB_BASIC_Y=$(create_price   "Casual Yearly (15% OFF)"     9504  year "type=subscription
tier=basic-yearly
discount_pct=15
credits_per_month=0
pricing_version=v3")
SUB_PREMIUM_Y=$(create_price "Regular Yearly (30% OFF)"   20064 year "type=subscription
tier=premium-yearly
discount_pct=30
credits_per_month=0
pricing_version=v3")
SUB_PRO_Y=$(create_price     "Hobbyist Yearly (50% OFF)"  41184 year "type=subscription
tier=pro-yearly
discount_pct=50
credits_per_month=0
pricing_version=v3")
SUB_ELITE_Y=$(create_price   "Power User Yearly (70% OFF)" 83424 year "type=subscription
tier=elite-yearly
discount_pct=70
credits_per_month=0
pricing_version=v3")

cat <<EOF

============================================
Paste these into Vercel env (Production):

STRIPE_PRICE_SUB_BASIC=$SUB_BASIC
STRIPE_PRICE_SUB_PREMIUM=$SUB_PREMIUM
STRIPE_PRICE_SUB_PRO=$SUB_PRO
STRIPE_PRICE_SUB_ELITE=$SUB_ELITE

STRIPE_PRICE_SUB_BASIC_YEARLY=$SUB_BASIC_Y
STRIPE_PRICE_SUB_PREMIUM_YEARLY=$SUB_PREMIUM_Y
STRIPE_PRICE_SUB_PRO_YEARLY=$SUB_PRO_Y
STRIPE_PRICE_SUB_ELITE_YEARLY=$SUB_ELITE_Y
============================================

Preview diff + test checkout at /admin/stripe-prices before redeploying.
EOF

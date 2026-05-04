#!/usr/bin/env bash
# ============================================================
# DEPRECATED — DO NOT RUN. Kept only for historical reference.
#
# This is the v1 pricing setup (basic + premium tiers, old pack
# sizes, old per-credit costs). It does NOT match what the
# frontend (`src/lib/api.ts`) or backend (`api/checkout.ts`)
# currently expect.
#
# Use `scripts/setup-stripe-products-v2.sh` instead, which creates
# the full 4-tier ladder (basic/premium/pro/elite + yearly) and
# matches the prices the UI advertises.
# ============================================================
echo "ERROR: This script is deprecated. Use setup-stripe-products-v2.sh instead." >&2
exit 1

# ── Original v1 script below (unreachable) ──────────────────
# Creates all Stripe products & prices for Grok Imagine SaaS.
# Requires: stripe CLI installed & authenticated (stripe login)
#
# Usage:
#   bash scripts/setup-stripe-products.sh
#   bash scripts/setup-stripe-products.sh --live   # for production
#
# Outputs the price IDs you need for Supabase secrets.
# ============================================================

set -euo pipefail

MODE="test"
if [[ "${1:-}" == "--live" ]]; then
  MODE="live"
  echo "=== LIVE MODE — real money ==="
else
  echo "=== TEST MODE (pass --live for production) ==="
fi

STRIPE_FLAGS=""
if [[ "$MODE" == "live" ]]; then
  STRIPE_FLAGS="--live"
fi

echo ""
echo "Creating one-time credit packs..."

# ── Starter: 50 credits for $5 ──
STARTER=$(stripe prices create $STRIPE_FLAGS \
  --currency usd \
  --unit-amount 500 \
  -d "product_data[name]=Starter Pack (50 Credits)" \
  -d "product_data[metadata][type]=pack" \
  -d "product_data[metadata][credits]=50" \
  --format json | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "  STRIPE_PRICE_STARTER=$STARTER"

# ── Pro: 175 credits for $15 ──
PRO=$(stripe prices create $STRIPE_FLAGS \
  --currency usd \
  --unit-amount 1500 \
  -d "product_data[name]=Pro Pack (175 Credits)" \
  -d "product_data[metadata][type]=pack" \
  -d "product_data[metadata][credits]=175" \
  --format json | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "  STRIPE_PRICE_PRO=$PRO"

# ── Mega: 450 credits for $35 ──
MEGA=$(stripe prices create $STRIPE_FLAGS \
  --currency usd \
  --unit-amount 3500 \
  -d "product_data[name]=Mega Pack (450 Credits)" \
  -d "product_data[metadata][type]=pack" \
  -d "product_data[metadata][credits]=450" \
  --format json | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "  STRIPE_PRICE_MEGA=$MEGA"

echo ""
echo "Creating monthly subscription plans..."

# ── Basic: 150 credits/mo for $9.99 ──
SUB_BASIC=$(stripe prices create $STRIPE_FLAGS \
  --currency usd \
  --unit-amount 999 \
  -d "recurring[interval]=month" \
  -d "product_data[name]=Basic Monthly (150 Credits/mo)" \
  -d "product_data[metadata][type]=subscription" \
  -d "product_data[metadata][tier]=basic" \
  -d "product_data[metadata][credits_per_month]=150" \
  --format json | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "  STRIPE_PRICE_SUB_BASIC=$SUB_BASIC"

# ── Premium: 500 credits/mo for $24.99 ──
SUB_PREMIUM=$(stripe prices create $STRIPE_FLAGS \
  --currency usd \
  --unit-amount 2499 \
  -d "recurring[interval]=month" \
  -d "product_data[name]=Premium Monthly (500 Credits/mo)" \
  -d "product_data[metadata][type]=subscription" \
  -d "product_data[metadata][tier]=premium" \
  -d "product_data[metadata][credits_per_month]=500" \
  --format json | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "  STRIPE_PRICE_SUB_PREMIUM=$SUB_PREMIUM"

echo ""
echo "============================================"
echo "Done! Set these in Supabase secrets:"
echo ""
echo "supabase secrets set \\"
echo "  STRIPE_PRICE_STARTER=$STARTER \\"
echo "  STRIPE_PRICE_PRO=$PRO \\"
echo "  STRIPE_PRICE_MEGA=$MEGA \\"
echo "  STRIPE_PRICE_SUB_BASIC=$SUB_BASIC \\"
echo "  STRIPE_PRICE_SUB_PREMIUM=$SUB_PREMIUM"
echo "============================================"

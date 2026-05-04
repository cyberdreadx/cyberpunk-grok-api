# ============================================================
# DEPRECATED - DO NOT RUN. Kept only for historical reference.
#
# This is the v1 pricing setup (basic + premium tiers only).
# It does NOT match what the frontend or backend now expect.
#
# Use scripts/setup-stripe-products-v2.sh instead, which creates
# the full 4-tier ladder (basic/premium/pro/elite + yearly).
# ============================================================

param([switch]$Live)

Write-Error "This script is deprecated. Use scripts/setup-stripe-products-v2.sh instead."
exit 1

$ErrorActionPreference = "Stop"

if ($Live) {
    Write-Host "=== LIVE MODE - real money ===" -ForegroundColor Red
} else {
    Write-Host "=== TEST MODE (pass -Live for production) ===" -ForegroundColor Yellow
}

# Verify stripe CLI is available
try {
    $null = & stripe --version 2>$null
} catch {
    Write-Host "ERROR: Stripe CLI not found. Install with: winget install Stripe.StripeCLI" -ForegroundColor Red
    exit 1
}

function New-StripePrice {
    param(
        [string]$Name,
        [int]$AmountCents,
        [hashtable]$Metadata,
        [string]$Interval  # "month" or "" for one-time
    )

    $cmd = @("prices", "create", "--currency", "usd", "--unit-amount", "$AmountCents")
    $cmd += @("-d", "product_data[name]=$Name")

    foreach ($key in $Metadata.Keys) {
        $cmd += @("-d", "product_data[metadata][$key]=$($Metadata[$key])")
    }

    if ($Interval) {
        $cmd += @("-d", "recurring[interval]=$Interval")
    }

    if ($Live) {
        $cmd += "--live"
    }

    # Run stripe CLI — outputs JSON by default
    $rawJson = & stripe @cmd 2>&1
    $joined = ($rawJson | Out-String).Trim()

    if (-not $joined) {
        Write-Host "  ERROR: stripe returned no output" -ForegroundColor Red
        exit 1
    }

    $parsed = $joined | ConvertFrom-Json

    if ($parsed.error) {
        Write-Host "  ERROR: $($parsed.error.message)" -ForegroundColor Red
        exit 1
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: stripe command failed (exit code $LASTEXITCODE)" -ForegroundColor Red
        Write-Host "  Output: $joined" -ForegroundColor Yellow
        exit 1
    }

    if (-not $parsed.id) {
        Write-Host "  ERROR: No price ID in response" -ForegroundColor Red
        Write-Host "  Output: $joined" -ForegroundColor Yellow
        exit 1
    }

    return $parsed.id
}

Write-Host ""
Write-Host "Creating one-time credit packs..." -ForegroundColor Cyan

$starter = New-StripePrice -Name "Starter Pack (50 Credits)" -AmountCents 500 `
    -Metadata @{ type = "pack"; credits = "50" }
Write-Host "  STRIPE_PRICE_STARTER=$starter" -ForegroundColor White

$pro = New-StripePrice -Name "Pro Pack (175 Credits)" -AmountCents 1500 `
    -Metadata @{ type = "pack"; credits = "175" }
Write-Host "  STRIPE_PRICE_PRO=$pro" -ForegroundColor White

$mega = New-StripePrice -Name "Mega Pack (450 Credits)" -AmountCents 3500 `
    -Metadata @{ type = "pack"; credits = "450" }
Write-Host "  STRIPE_PRICE_MEGA=$mega" -ForegroundColor White

Write-Host ""
Write-Host "Creating monthly subscription plans..." -ForegroundColor Cyan

$subBasic = New-StripePrice -Name "Basic Monthly (150 Credits/mo)" -AmountCents 999 -Interval "month" `
    -Metadata @{ type = "subscription"; tier = "basic"; credits_per_month = "150" }
Write-Host "  STRIPE_PRICE_SUB_BASIC=$subBasic" -ForegroundColor White

$subPremium = New-StripePrice -Name "Premium Monthly (500 Credits/mo)" -AmountCents 2499 -Interval "month" `
    -Metadata @{ type = "subscription"; tier = "premium"; credits_per_month = "500" }
Write-Host "  STRIPE_PRICE_SUB_PREMIUM=$subPremium" -ForegroundColor White

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "All 5 products created! Copy-paste this:" -ForegroundColor Green
Write-Host ""
Write-Host "STRIPE_PRICE_STARTER=$starter" -ForegroundColor White
Write-Host "STRIPE_PRICE_PRO=$pro" -ForegroundColor White
Write-Host "STRIPE_PRICE_MEGA=$mega" -ForegroundColor White
Write-Host "STRIPE_PRICE_SUB_BASIC=$subBasic" -ForegroundColor White
Write-Host "STRIPE_PRICE_SUB_PREMIUM=$subPremium" -ForegroundColor White
Write-Host ""
Write-Host "============================================" -ForegroundColor Green

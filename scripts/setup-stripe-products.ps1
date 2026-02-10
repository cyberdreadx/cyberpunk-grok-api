# ============================================================
# Creates all Stripe products & prices for Grok Imagine SaaS.
# Requires: stripe CLI installed & authenticated (stripe login)
#
# Usage:
#   .\scripts\setup-stripe-products.ps1            # test mode
#   .\scripts\setup-stripe-products.ps1 -Live       # production
# ============================================================

param([switch]$Live)

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
    $rawJson = & stripe @cmd 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: stripe command failed (exit code $LASTEXITCODE)" -ForegroundColor Red
        Write-Host "  Tip: make sure you ran 'stripe login' first" -ForegroundColor Yellow
        exit 1
    }

    $joined = $rawJson -join "`n"
    $parsed = $joined | ConvertFrom-Json
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
Write-Host "supabase secrets set STRIPE_PRICE_STARTER=$starter STRIPE_PRICE_PRO=$pro STRIPE_PRICE_MEGA=$mega STRIPE_PRICE_SUB_BASIC=$subBasic STRIPE_PRICE_SUB_PREMIUM=$subPremium" -ForegroundColor White
Write-Host ""
Write-Host "============================================" -ForegroundColor Green

## Goal

Recover the 17.5% Stripe loan deduction without users feeling the pinch, and rebuild subscriptions around a per-generation **discount** instead of monthly bonus credits (kills the subscribe → cancel → resubscribe credit-farming loop).

---

## Strategy 1 — Pricing uplift ("still a deal")

A flat ~21% bump everywhere makes prices look ugly ($4.99 → $6.05) and screams "price hike". Instead, use **psychological repricing**: bump prices to clean charm-priced numbers AND bump credit amounts a little, so the *per-credit* price actually looks better than today. Users see "more credits, only a buck more, cheaper per credit" — they feel they're winning, you net ≥ today after Stripe's 17.5%.

### New credit packs

| Pack | Old | New price | New credits | Old $/cr | New $/cr | Net after 17.5% vs old net |
|------|-----|-----------|-------------|----------|----------|----------------------------|
| STARTER | $5.00 / 50 | **$6.99 / 75** | +50% credits | $0.100 | **$0.093** | $5.77 vs $5.00 → +15% |
| PRO | $15.00 / 175 | **$18.99 / 240** | +37% credits | $0.086 | **$0.079** | $15.67 vs $15.00 → +4% |
| MEGA | $35.00 / 450 | **$42.99 / 600** | +33% credits | $0.078 | **$0.072** | $35.47 vs $35.00 → +1% |
| ULTRA | $150.00 / 2200 | **$179.99 / 2600** | +18% credits | $0.068 | **$0.069** | $148.49 vs $150 → ~flat |
| ENTERPRISE | $300.00 / 4500 | **$359.99 / 5400** | +20% credits | $0.067 | **$0.067** | $296.99 vs $300 → ~flat |

Rationale: small packs (where Stripe's 30¢ flat fee + 17.5% hurt margin most) get the biggest uplift; whales already get great per-credit so we hold the line. Every tier's per-credit price drops or stays flat → marketing line: **"More credits, lower per-credit price."**

### New subscription prices

Subs stop granting credits (see Strategy 2), so the headline price drops while value grows. This is the pitch: *"Pay less monthly AND get a permanent discount on every generation."*

| Tier | Old | New price | Discount (see Strategy 2) |
|------|-----|-----------|--------------------------|
| BASIC | $9.99 | **$7.99/mo** | 15% off |
| PREMIUM | $24.99 | **$19.99/mo** | 30% off |
| PRO | $79.99 | **$59.99/mo** | 50% off |
| ELITE | $299.99 | **$199.99/mo** | 70% off |

Yearly tiers: same 12% saving vs monthly, recomputed off the new monthly prices.

---

## Strategy 2 — Subscriptions become a discount, not a credit faucet

### Discount tiers (smart curve)

| Tier | Discount | Why |
|------|----------|-----|
| BASIC | **15%** | Just enough to feel like a perk |
| PREMIUM | **30%** | Sweet spot; popular tier |
| PRO | **50%** | Power-user clear win |
| ELITE | **70%** | Whale tier; cheaper than buying packs |

**Why this is smarter than flat % or steeper curves:**
- Cannot be gamed: cancel → resubscribe gives you nothing extra on day 1, only the discount while active. No more "subscribe, drain bonus credits, cancel, repeat."
- Discount value scales with *usage*, so heavy users self-select into higher tiers (good revenue).
- ELITE 70% off is still > our cost margin (we sell at ~140% margin today), so even ELITE remains profitable.
- Discount applies to **both per-generation credit cost AND new pack purchases** in-app. Pack discount ≠ price reduction at Stripe; we credit extra credits to make Stripe net the same. (See Tech.)

### What replaces the "monthly credits" pitch

Marketing copy becomes: *"Subscribers pay X% less on every image, video, and edit — forever, no expiry, no math."* This sounds **better** than "150 credits/month that expire" because it removes loss aversion (expiring credits) and is unbounded.

---

## Strategy 3 — Existing balances

Per your choice: **keep current `sub_credits` spendable, stop topping them up.** No migration, no surprises. On next renewal, the user keeps any remaining sub_credits AND starts getting the discount. Comms: *"Bonus: you keep your unspent subscription credits, plus you now get [X]% off everything."*

---

## Technical changes

### Backend
- **`src/lib/api.ts`** — update `CREDIT_PACKAGES` and `SUBSCRIPTION_TIERS_MONTHLY`/`_YEARLY` with new prices & credit amounts. Add `discountPercent` field on each tier. Recompute `perCredit` strings.
- **Stripe price IDs** — new `STRIPE_PRICE_*` env vars needed for every changed pack/tier (Stripe prices are immutable). I'll write a one-shot migration script (`scripts/setup-stripe-products-v2.sh`) that creates all new prices and prints the env-var block to paste into Vercel.
- **`api/checkout.ts`** — update `PACKAGES` (credits per pack) and `SUBSCRIPTIONS` (creditsPerMonth → 0; add `discountPercent` metadata).
- **`api/webhook.ts`** — on `invoice.paid`, stop calling `reset_sub_credits` for subscriptions; instead set `users.subscription_discount_pct` (new column). Keep packs unchanged but use new credit amounts.
- **New migration** `migrations/034_subscription_discount.sql` — add `subscription_discount_pct INT DEFAULT 0` to `users`.
- **Cost calculation** — central helper `applySubscriptionDiscount(cost, user)` returns `Math.ceil(cost * (1 - pct/100))`. Wire into:
  - `api/generate.ts` (`calculateCost` result)
  - `api/gltch.ts`
  - `api/comfyui.ts`
  - `api/chat.ts`
  - `api/v1/_lib/credits.ts` (public API parity)
- **Pack purchases by subscribers** — at checkout we *cannot* lower the Stripe charge mid-flight cleanly, so instead the webhook detects the buyer's `subscription_discount_pct` and grants **bonus credits** equal to `credits * pct / (100 - pct)` (mathematically equivalent to the discount). Logged separately in `usage_log` for transparency.
- **`api/credits.ts`** — return `subscription_discount_pct` so UI can show the badge.
- **`telegram-bot/src/config.ts`** — sync `CREDIT_PACKS` to new prices/credits.

### Frontend
- **`src/components/PricingCards.tsx`** — replace "X credits/month" with "**X% OFF every generation**"; show example: *"A 6-credit edit costs you only 3."* Add savings calculator.
- **`src/components/CreditDisplay.tsx`** / **`MobileCreditsPill.tsx`** — show active discount badge ("PREMIUM • 30% OFF").
- **Cost badges** on Generate/Edit/Video buttons — show strikethrough original cost + discounted cost when subscribed.
- **`src/pages/Index.tsx`** / pack pickers — show "+ X bonus credits with your PRO sub" line on pack tiles for subscribers.
- **i18n** — update all 10 locale files for new copy ("X% off" instead of "X credits/month").

### Comms (one-time)
- Resend announcement campaign: *"Pricing update: more credits in every pack, subscriptions now give you up to 70% off every generation forever, and your existing credits are safe."*
- In-app changelog dialog entry.

---

## Rollout order

1. Migration `034_subscription_discount.sql`.
2. Stripe products script → user runs it → pastes new env vars to Vercel.
3. Backend: discount helper + wire into all generation endpoints + webhook changes + `api/checkout.ts` + `api/credits.ts`.
4. Frontend: `api.ts` constants, pricing UI, cost badges, balance pill, i18n.
5. Telegram bot price sync.
6. Changelog dialog + announcement email.

---

## Net impact

- **Stripe loan absorbed**: small/mid packs net +1–15% even after the 17.5% take.
- **No anti-game loophole**: subscribers can't farm bonus credits anymore.
- **Better perceived value**: lower per-credit pack price, lower headline sub price, permanent discount that doesn't expire — all three are stronger marketing than today's offer.
- **Existing users unharmed**: keep their sub_credits, start getting the discount automatically.

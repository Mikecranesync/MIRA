# Florida Automation Expo — May 21, 2026

Expo-day cheat sheet so attendees can buy FactoryLM from the booth.

## TL;DR — Pages live for the expo

| URL | Purpose |
|-----|---------|
| `factorylm.com/buy` | **Mobile-optimized purchase page.** Show on phone, hand over. QR target. |
| `factorylm.com/pricing` | Full pricing page (existing). |
| Booth QR sticker → `factorylm.com/buy` | Print `docs/promo-screenshots/2026-05-11_buy-page-qr_expo.png` |

## Mike — DO BEFORE THE EXPO

### 1. Switch Stripe to LIVE mode  ⚠️ REQUIRED

Doppler currently has **TEST** keys (`sk_test_...`). Confirmed `2026-05-11`:

```
$ doppler secrets get STRIPE_SECRET_KEY --project factorylm --config prd --plain
sk_test_51SiegW…
```

If you take payments at the expo on test mode, **nothing actually charges**.

Manual steps (Mike — security-sensitive, do this yourself):

1. Stripe Dashboard → toggle to **Live mode** (top-right).
2. Developers → API keys → reveal **live secret key** (`sk_live_…`).
3. Developers → Webhooks → add endpoint `https://factorylm.com/api/stripe/webhook`,
   subscribe to `checkout.session.completed`, `customer.subscription.deleted`,
   `customer.subscription.updated`. Copy signing secret (`whsec_…`).
4. Products → confirm the $97/mo "MIRA Troubleshooter" price exists in **Live**
   (test-mode price IDs do not transfer). Copy live price ID (`price_…`).
5. Update Doppler `factorylm/prd`:
   ```
   doppler secrets set STRIPE_SECRET_KEY=sk_live_… --project factorylm --config prd
   doppler secrets set STRIPE_WEBHOOK_SECRET=whsec_… --project factorylm --config prd
   doppler secrets set STRIPE_PRICE_ID=price_… --project factorylm --config prd
   ```
6. Redeploy mira-web on the VPS (`docker compose up -d --build mira-web`).
7. Smoke test from your phone: visit `factorylm.com/buy`, hit "Subscribe",
   confirm the Stripe page says **NOT in test mode** (no orange banner).

### 2. Optional — create $297 "Integrated" price

The /buy page shows two paid tiers. Both currently route through the single
`STRIPE_PRICE_ID` ($97). To make the $297 button actually charge $297, add a
second product in Stripe and wire it up — leave for after the expo if time is
tight. The $97 path is the moneymaker.

### 3. Print the QR

File: `docs/promo-screenshots/2026-05-11_buy-page-qr_expo.png` (820×820, high error correction).
Target URL: `https://factorylm.com/buy`.
Print at 4"+ square for booth visibility. Test scan with your phone before
the expo.

## What's wired up

CTAs added in this branch:

- **Topbar (every TS-rendered page)** → "Get Started" → `/buy`
- **Pricing page nav** → "Get Started" → `/buy`
- **Home hero** → "Start Free Trial" → `/buy`
- **CMMS landing hero** → "View plans →" → `/buy`
- **QR scan chooser footer** → "Start Free Trial" → `/buy`
- **QR scan report footer** → "Start Free Trial" → `/buy`
- **New page** `/buy` — clean, mobile-first, 2 plans + Enterprise contact

## During the expo

- Booth backdrop: laptop or iPad locked to `factorylm.com/buy`
- Printed QR: posted at eye level, points to `factorylm.com/buy`
- Slip handout: `factorylm.com/buy` written large
- If anyone wants Enterprise (>1 plant, SSO): "Talk to Mike" button → emails you direct

## After the expo

- Pull Stripe → check live Customers tab
- PostHog event `buy_page_cta_click` shows funnel attribution per CTA slot

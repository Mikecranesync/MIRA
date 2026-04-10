---
name: stripe
description: Stripe CLI operations for MIRA beta onboarding — create product/price/webhook, test webhooks locally, switch test/live mode
---

## Environment

- CLI binary: `~/.local/bin/stripe.exe` (v1.40.3)
- Logged in: yes (run `stripe config --list` to confirm mode)
- Code: `mira-web/src/lib/stripe.ts` — Checkout, Portal, webhook verify
- Webhook handler: `mira-web/src/server.ts` — switch on `event.type`
- Env vars (Doppler `factorylm/prd`):
  - `STRIPE_SECRET_KEY` — server-side API secret
  - `STRIPE_WEBHOOK_SECRET` — signing secret for `/api/stripe/webhook`
  - `STRIPE_PRICE_ID` — the $97/mo recurring price

## Create product + $97/mo price (KANBAN #103)

1. Confirm test mode first:
   ```
   stripe config --list
   ```
   Expect `test_mode_api_key` set. If only `live_mode_api_key` is set, run `stripe login` and pick test mode.

2. Create the product:
   ```
   stripe products create \
     --name "FactoryLM Beta" \
     --description "Beta access to FactoryLM maintenance intelligence"
   ```
   Copy the returned `prod_...` id.

3. Create the recurring price tied to it:
   ```
   stripe prices create \
     --product prod_XXXXX \
     --currency usd \
     --unit-amount 9700 \
     -d "recurring[interval]=month"
   ```
   Copy the returned `price_...` id.

4. Save to Doppler:
   ```
   doppler secrets set STRIPE_PRICE_ID price_XXXXX \
     --project factorylm --config prd
   ```

## Create webhook endpoint (production)

The handler in `mira-web/src/server.ts` handles exactly 3 events:

- `checkout.session.completed` — flips tenant `pending` → `active`, seeds demo data
- `customer.subscription.updated` — sync subscription state
- `customer.subscription.deleted` — flips tenant → `churned`

Create the endpoint pointed at production:

```
stripe webhook_endpoints create \
  --url https://factorylm.com/api/stripe/webhook \
  --enabled-events checkout.session.completed \
  --enabled-events customer.subscription.updated \
  --enabled-events customer.subscription.deleted
```

Copy the returned `whsec_...` and save it:

```
doppler secrets set STRIPE_WEBHOOK_SECRET whsec_XXXXX \
  --project factorylm --config prd
```

## Test webhooks locally (KANBAN #107)

1. Start mira-web locally on port 3200.

2. Forward live Stripe events to the local handler:
   ```
   stripe listen --forward-to localhost:3200/api/stripe/webhook
   ```
   This prints a LOCAL `whsec_...` — set it as `STRIPE_WEBHOOK_SECRET` in your local dev env only, NOT the production Doppler value.

3. In a second terminal, trigger a test event:
   ```
   stripe trigger checkout.session.completed
   ```

4. Verify:
   - `stripe listen` shows 2xx response from the endpoint
   - mira-web logs `[stripe-webhook] Event: checkout.session.completed ...`
   - Tenant row in NeonDB flipped `pending` → `active`
   - `beta-activated.html` email was sent

## Switch test ↔ live mode

- `stripe login` — prompts for account + mode, pick test OR live
- `stripe config --list` — confirm which mode is active before running any command
- Products, prices, customers, and webhook endpoints do NOT cross between test and live — create them separately in each mode
- Stay in test until the end-to-end signup flow is verified at least once

## Safety

- Products and prices can be **archived** but not truly **deleted**. Verify name + amount before running `stripe prices create`.
- Live mode creates real charges. Never run live-mode commands until test mode passes end-to-end.
- Never commit `sk_live_...` or `whsec_...` to git. Always Doppler.
- Run `git remote -v` before any commit — `~/.claude/` and MIRA root are different repos.

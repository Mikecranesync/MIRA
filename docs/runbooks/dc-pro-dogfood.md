# Drive Commander Pro — Dogfood & Ops Runbook

**PR:** PMF-DC-PRO-STRIPE-UNLOCK-001  
**Locked 2026-09-05 (Mike):** Lead SKU = $197/yr annual. First paid pack = Siemens G120. First human offer = Mike dogfood.

---

## Env vars ops must set (names only — values go into Doppler)

| Doppler key | Config | Purpose |
|---|---|---|
| `STRIPE_DRIVE_COMMANDER_PRICE_ID` | `factorylm/prd` | Stripe Price ID for Drive Commander Pro **$197/yr annual recurring** subscription. Create in Stripe Dashboard → Products → Drive Commander Pro → Add price (recurring, annual, $197). |
| `STRIPE_SECRET_KEY` | `factorylm/prd` | Already set (shared with CMMS checkout) |
| `STRIPE_WEBHOOK_SECRET` | `factorylm/prd` | Already set (shared) — webhook endpoint must route `checkout.session.completed` events |
| `PLG_JWT_SECRET` | `factorylm/prd` | Already set — used to sign the Pro entitlement cookie |

**Do NOT set** `STRIPE_DRIVE_COMMANDER_PRICE_ID` in `factorylm/dev` during development — the missing-price fallback redirects to `/pricing?product=drive-commander-pro` (graceful, no error).

---

## How Mike dogfoods (test card, step by step)

> Prerequisites: `STRIPE_DRIVE_COMMANDER_PRICE_ID` set in Doppler stg pointing at the **Stripe test-mode** price.

1. Open an incognito window → navigate to `https://factorylm.com/drive-commander/siemens-g120`
2. Confirm page shows the G120 fault library + a **"Unlock Drive Commander Pro — $197/yr →"** CTA.
3. Click the CTA → Stripe Checkout loads.
4. Use test card: **`4242 4242 4242 4242`**, any future expiry, any CVC, any zip.
5. Complete checkout.
6. Stripe redirects to `/drive-commander/siemens-g120?checkout=success&session_id=cs_test_...`
7. Server calls `verifyDCProSession(session_id)`:
   - Retrieves session from Stripe → confirms `payment_status=paid` and `metadata.product=drive-commander-pro`
   - Looks up tenant by email (or creates one) → confirms `tier=drive_commander_pro`
   - Issues a JWT entitlement cookie (`mira_session`)
8. Page renders with Pro content unlocked (no `pro-lock` div in DOM).
9. Refresh the page (no checkout params) → cookie re-validates → still shows Pro.
10. Verify no CMMS/Atlas provisioning: the Stripe webhook handler hits the DC Pro branch and **breaks** before `finalizeActivation`. No Atlas API calls. No Hub provisioning.

### To cancel and retest
- Go to `stripe.com/dashboard/test/subscriptions` → cancel the test subscription.
- Clear the `mira_session` cookie.
- Reload the G120 page → Pro lock gate should reappear.

---

## Checkout smoke gate status

- **Test-mode smoke**: run the dogfood steps above in staging against a test-mode price ID.
- **Live-mode gate**: before prod deploy, confirm `STRIPE_DRIVE_COMMANDER_PRICE_ID` points at a live-mode Stripe price. Use `stripe listen --forward-to localhost:3200/api/stripe/webhook` locally to verify the webhook receives `checkout.session.completed` events.
- No automated CI checkout smoke exists yet (Stripe test mode requires live network). Manual dogfood is the gate.

---

## What does NOT activate

- ❌ CMMS/Atlas tenant provisioning (`finalizeActivation` is NOT called)
- ❌ Hub provisioning (`activateHubUserByEmail` is NOT called)
- ❌ `$97` CMMS subscription path is unaffected

---

## Rollback

If the DC Pro webhook branch misbehaves in prod:
1. Set `STRIPE_DRIVE_COMMANDER_PRICE_ID=` (blank) in Doppler prd → redeploy → CTA redirects to `/pricing?product=drive-commander-pro` (no checkout, no charge).
2. The existing CMMS checkout path is unchanged and unaffected.

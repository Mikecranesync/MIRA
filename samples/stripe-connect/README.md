# Stripe Connect Sample

A self-contained sample app demonstrating the **full Stripe Connect flow** on
[Hono](https://hono.dev) + Node/Bun with the latest Stripe SDK (`stripe@22`).

It shows, end to end:

1. Creating connected accounts with the **V2 Core Accounts API**
2. Onboarding them with **V2 Account Links** + checking live status
3. Receiving **thin-event webhooks** for account requirements/capabilities
4. Creating **products** on a connected account
5. A public **storefront** per connected account
6. **Direct charges** with an application fee (hosted Checkout)
7. **Subscriptions** that bill the connected account (`customer_account`)
8. The **billing portal** for the connected account
9. **Standard V1 webhooks** for the subscription lifecycle

> This is a teaching sample. Storage is in-memory (resets on restart) and the
> UI is server-rendered HTML. Every Stripe API call is heavily commented in the
> source. Search the code for `// PLACEHOLDER:` to find every value you should
> replace for your own use.

---

## Quick start

```bash
# 1. Install dependencies (Bun recommended; npm also works)
bun install        # or: npm install

# 2. Configure your Stripe keys
cp .env.example .env
#    then edit .env — at minimum set STRIPE_SECRET_KEY (sk_test_...)

# 3. Run it
bun run dev        # or: npm run start:node   (Node 22+, uses --env-file)
```

Open <http://localhost:4242>.

You can click through account creation, onboarding, product creation, the
storefront, a direct-charge checkout, a subscription, and the billing portal
with just `STRIPE_SECRET_KEY` set. The webhook endpoints and the subscription
demo need a couple more values — see below.

---

## Environment variables

See `.env.example` for the annotated list. Summary:

| Var | Required for | What it is |
|-----|-------------|------------|
| `STRIPE_SECRET_KEY` | everything | Your **platform** account secret key (`sk_test_...`). |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | section 3 webhooks | Signing secret for the **thin-event** endpoint. |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | section 9 webhooks | Signing secret for the **standard-event** endpoint. |
| `PRICE_ID` | subscriptions | A recurring `price_...` on your platform account. |
| `PUBLIC_BASE_URL` | optional | Public URL for Stripe redirects (set behind a tunnel). |
| `PORT` | optional | HTTP port (default `4242`). |

The server **fails fast at boot** if `STRIPE_SECRET_KEY` is missing, with a
message telling you exactly what to set. The other vars are validated lazily,
only when their feature is exercised.

---

## How it maps to the code

| Concern | File |
|---------|------|
| The single Stripe Client + env validation | `src/stripe.ts` |
| In-memory storage (with `TODO(db)` notes) | `src/store.ts` |
| Public-URL / port resolution | `src/config.ts` |
| HTML rendering (dark theme) | `src/views.ts` |
| Create V2 account, onboarding, status, dashboard/detail UI | `src/routes/accounts.ts` |
| Create products, public storefront | `src/routes/products.ts` |
| Direct charge + application fee, success/cancel pages | `src/routes/checkout.ts` |
| Subscriptions (`customer_account`) + billing portal | `src/routes/subscriptions.ts` |
| Thin-event + standard-event webhooks | `src/routes/webhooks.ts` |
| Wiring + server bootstrap | `server.ts` |

### The "Stripe Client" pattern

There is exactly **one** `Stripe` instance, constructed in `src/stripe.ts` and
imported everywhere as `stripeClient`. Every Stripe call in this sample goes
through `stripeClient.*` — never a bare `stripe.xxx`.

### V2 accounts — no `type`

Connected accounts are created with `stripeClient.v2.core.accounts.create(...)`.
This sample **never** passes a top-level `type: 'express' | 'standard' |
'custom'`. In V2, account behaviour is described by `configuration` (customer /
merchant) and `dashboard` access, not a legacy account "type".

### Acting on behalf of a connected account

Two distinct mechanisms, used deliberately:

- **`{ stripeAccount: 'acct_...' }`** request option → the call runs *as* the
  connected account (creating products, listing products, direct-charge
  checkout). Used in `products.ts` and `checkout.ts`.
- **`customer_account: 'acct_...'`** parameter → the connected account is the
  *customer being billed* (subscriptions, billing portal). Used in
  `subscriptions.ts`. For V2 accounts this replaces the V1 `customer`
  (`cus_...`) reference.

---

## Webhooks

This sample exposes **two** webhook endpoints because Stripe has two delivery
formats and we use both. They have **separate signing secrets**.

### 1. Thin-event webhook — connected account status

`POST /webhooks/connect` handles V2 **thin events** for account
requirements/capabilities:

- `v2.core.account[requirements].updated`
- `v2.core.account[configuration.merchant].capability_status_updated`
- `v2.core.account[configuration.customer].capability_status_updated`

Verify + parse with the SDK, then fetch the full event:

```ts
// NOTE: older docs call this parseThinEvent(); stripe-node v22 renamed it to
// parseEventNotification() — same purpose, same (payload, sig, secret) args.
const notification = stripeClient.parseEventNotification(body, sig, secret);
const event = await stripeClient.v2.core.events.retrieve(notification.id);
```

Forward them locally with the Stripe CLI (note `--thin-events` +
`--forward-thin-to`):

```bash
stripe listen \
  --thin-events 'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' \
  --forward-thin-to localhost:4242/webhooks/connect
```

The CLI prints a `whsec_...` → put it in `STRIPE_CONNECT_WEBHOOK_SECRET`.

### 2. Standard-event webhook — subscription lifecycle

`POST /webhooks/subscriptions` handles standard **V1** events (NOT thin):

- `customer.subscription.updated` (upgrades, downgrades, quantity, pause/resume,
  `cancel_at_period_end`)
- `customer.subscription.deleted`
- `payment_method.attached` / `payment_method.detached`
- `customer.updated`
- `invoice.paid` / `invoice.payment_failed`

Verify + parse with the classic helper (full payload inline, no second fetch):

```ts
const event = stripeClient.webhooks.constructEvent(body, sig, secret);
```

Forward them locally with a plain listener (separate terminal, separate secret):

```bash
stripe listen --forward-to localhost:4242/webhooks/subscriptions
# then, to test:
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
```

The CLI prints a different `whsec_...` → put it in
`STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`.

> **Raw body matters.** Signature verification uses the exact raw request body.
> Both handlers read it with `c.req.text()` and pass the string straight to the
> verifier — never `JSON.parse` first.

Each handler logs what it received and marks the place to persist with
`TODO(db):` comments.

---

## Notes & caveats

- **Storage is in-memory** (`src/store.ts`). It resets on restart. The Stripe
  account object is always the source of truth for status — we re-fetch it on
  every account view rather than caching it. `TODO(db)` comments show where a
  real database would go.
- **Storefront URLs key on the `acct_...` id** for simplicity. In production,
  expose a friendlier identifier (a store slug) and resolve to the account id
  server-side, so you don't leak Stripe ids in URLs.
- **Application fee** in the direct-charge checkout is a demo 10% of the sale;
  replace with your real fee logic (`// PLACEHOLDER:` in `checkout.ts`).
- **SDK method name:** this sample targets `stripe@22`, where thin-event parsing
  is `parseEventNotification()`. Older samples/docs reference `parseThinEvent()`
  — it's the same operation under the previous name.
- **Test vs live:** keep `STRIPE_SECRET_KEY` on a `sk_test_...` key until the
  whole flow is verified. The boot log prints whether you're in TEST or LIVE.

---

## Scripts

| Script | What |
|--------|------|
| `bun run dev` | Run with file-watch (Bun). |
| `bun run start` | Run once (Bun). |
| `npm run start:node` | Run on Node 22+ (`--experimental-strip-types --env-file=.env`). |
| `npm run typecheck` | `tsc --noEmit` (requires a local `typescript`). |

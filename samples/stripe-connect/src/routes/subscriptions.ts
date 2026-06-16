// =============================================================================
// src/routes/subscriptions.ts — billing the CONNECTED ACCOUNT itself for a
// recurring platform plan. Covers spec section 8.
//
// KEY CONCEPT: here the connected account is the CUSTOMER (it pays YOU), so we
// pass `customer_account: "acct_..."` — NOT a `stripeAccount` header and NOT a
// `customer` (cus_...). For V2 accounts, `customer_account` is how you bill the
// account directly. The subscription is created on the PLATFORM account.
// =============================================================================

import type { Hono } from 'hono';
import { stripeClient, requireEnv } from '../stripe.ts';
import { rootUrl } from '../config.ts';

export function registerSubscriptionRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // POST /account/:id/subscribe — start a subscription Checkout that bills the
  // connected account for the platform's recurring PRICE_ID.
  // ---------------------------------------------------------------------------
  app.post('/account/:id/subscribe', async (c) => {
    const accountId = c.req.param('id');
    const root = rootUrl(c);

    // The recurring price on the PLATFORM account the connected account subscribes to.
    const priceId = requireEnv(
      'PRICE_ID',
      'A recurring Price id on your platform account (e.g. a monthly platform fee).',
    );

    // --- CREATE A SUBSCRIPTION CHECKOUT SESSION BILLING THE ACCOUNT. --------
    // NOTE the differences from the direct-charge checkout:
    //   - `customer_account` is the connected account id being billed.
    //   - there is NO `{ stripeAccount }` option — this runs on the PLATFORM.
    //   - mode is 'subscription'.
    const session = await stripeClient.checkout.sessions.create({
      // customer_account: bill THIS connected account (V2 accounts use
      // `customer_account`, not `customer`).
      customer_account: accountId, // PLACEHOLDER: the acct_... being billed.
      mode: 'subscription',
      line_items: [
        {
          price: priceId, // the platform's recurring price.
          quantity: 1,
        },
      ],
      success_url: `${root}/account/${accountId}?subscribed=1`, // PLACEHOLDER: your success URL.
      cancel_url: `${root}/account/${accountId}`, // PLACEHOLDER: your cancel URL.
    });

    return c.redirect(session.url ?? `/account/${accountId}`);
  });

  // ---------------------------------------------------------------------------
  // POST /account/:id/portal — open the Stripe Billing portal for the account
  // so it can manage / cancel its subscription and payment methods.
  // ---------------------------------------------------------------------------
  app.post('/account/:id/portal', async (c) => {
    const accountId = c.req.param('id');
    const root = rootUrl(c);
    const dashboardUrl = `${root}/account/${accountId}`;

    // --- CREATE A BILLING PORTAL SESSION FOR THE ACCOUNT. ------------------
    // Again `customer_account` (not `customer`) identifies the V2 connected
    // account whose billing we're managing. `return_url` is where the portal
    // sends them when they're done.
    const portal = await stripeClient.billingPortal.sessions.create({
      customer_account: accountId, // PLACEHOLDER: the acct_... whose billing to manage.
      return_url: dashboardUrl, // PLACEHOLDER: where to send them after the portal.
    });

    return c.redirect(portal.url);
  });
}

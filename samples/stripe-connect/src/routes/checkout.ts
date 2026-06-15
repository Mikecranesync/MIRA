// =============================================================================
// src/routes/checkout.ts — processing a charge with a DIRECT CHARGE + an
// application fee. Covers spec section 7, plus the /success and /cancel pages
// (spec section 10).
//
// DIRECT CHARGE model: the charge is created directly ON the connected account
// (via `{ stripeAccount }`). The customer pays the merchant; the platform skims
// a cut via `application_fee_amount`. The connected account is the merchant of
// record and shows up on the customer's statement.
// =============================================================================

import type { Hono } from 'hono';
import { stripeClient } from '../stripe.ts';
import { rootUrl } from '../config.ts';
import { layout, esc } from '../views.ts';

export function registerCheckoutRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // POST /store/:accountId/buy/:priceId — start a hosted Checkout for a direct
  // charge against the connected account, taking an application fee.
  // ---------------------------------------------------------------------------
  app.post('/store/:accountId/buy/:priceId', async (c) => {
    const accountId = c.req.param('accountId');
    const priceId = c.req.param('priceId');
    const root = rootUrl(c);

    // Look up the price (on the connected account) so we know the amount, which
    // we need to (a) compute the application fee and (b) build line_items via
    // price_data. We read it through the connected account context.
    // Reading on a connected account: pass {} for params and the connected
    // account in the 3rd (request-options) argument. `retrieve(id, params, opts)`.
    const price = await stripeClient.prices.retrieve(priceId, {}, { stripeAccount: accountId });
    const unitAmount = price.unit_amount ?? 0;
    const currency = price.currency ?? 'usd';

    // Platform fee: 10% of the sale here (demo value). This is the money the
    // PLATFORM keeps; the rest settles to the connected account.
    const applicationFeeAmount = Math.round(unitAmount * 0.1); // PLACEHOLDER: your fee logic.

    // Fetch the product name for a nicer line item label (optional).
    let productName = 'Purchase';
    if (typeof price.product === 'string') {
      const product = await stripeClient.products.retrieve(price.product, {}, { stripeAccount: accountId });
      productName = product.name ?? productName;
    }

    // --- CREATE THE CHECKOUT SESSION (DIRECT CHARGE). -----------------------
    // `{ stripeAccount: accountId }` makes this a DIRECT charge on the connected
    // account. `payment_intent_data.application_fee_amount` is the platform's
    // cut, deducted automatically and routed to the platform balance.
    const session = await stripeClient.checkout.sessions.create(
      {
        line_items: [
          {
            // price_data builds an ad-hoc price for this session. (You could also
            // pass `price: priceId` directly; we use price_data to show the shape
            // exactly as in the spec.)
            price_data: {
              currency,
              product_data: { name: productName },
              unit_amount: unitAmount,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          // The platform's fee for facilitating this sale (in cents).
          application_fee_amount: applicationFeeAmount,
        },
        mode: 'payment', // one-time payment (vs 'subscription').
        // Stripe replaces {CHECKOUT_SESSION_ID} with the real id on redirect.
        success_url: `${root}/success?session_id={CHECKOUT_SESSION_ID}`, // PLACEHOLDER: your success URL.
        cancel_url: `${root}/cancel`, // PLACEHOLDER: your cancel URL.
      },
      { stripeAccount: accountId }, // ← direct charge on the connected account.
    );

    // Checkout returns a hosted URL we send the buyer to.
    return c.redirect(session.url ?? `/store/${accountId}`);
  });

  // ---------------------------------------------------------------------------
  // GET /success — landing page after a successful Checkout.
  // ---------------------------------------------------------------------------
  app.get('/success', (c) => {
    const sessionId = c.req.query('session_id') ?? '';
    const body = `
      <div class="banner ok">✅ Payment complete.</div>
      <h1>Thanks for your purchase!</h1>
      <p class="sub">Your checkout session:</p>
      <p class="mono">${esc(sessionId)}</p>
      <p class="muted">In production, do NOT rely on this redirect alone to fulfil
        the order — confirm via the <code>checkout.session.completed</code> webhook,
        which is the authoritative signal that payment succeeded.</p>
      <p><a class="btn secondary" href="/">← Back to dashboard</a></p>`;
    return c.html(layout('Payment successful', body));
  });

  // ---------------------------------------------------------------------------
  // GET /cancel — landing page when the buyer abandons Checkout.
  // ---------------------------------------------------------------------------
  app.get('/cancel', (c) => {
    const body = `
      <div class="banner warn">Payment cancelled — you have not been charged.</div>
      <h1>Checkout cancelled</h1>
      <p><a class="btn secondary" href="/">← Back to dashboard</a></p>`;
    return c.html(layout('Payment cancelled', body));
  });
}

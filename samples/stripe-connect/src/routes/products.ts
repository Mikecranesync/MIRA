// =============================================================================
// src/routes/products.ts — creating and displaying products ON a connected
// account. Covers spec sections 5 (create product) and 6 (storefront).
//
// KEY CONCEPT: every call here is made "on behalf of" the connected account by
// passing `{ stripeAccount: accountId }` as the second argument (request
// options). The product is created in the CONNECTED account, not the platform.
// =============================================================================

import type { Hono } from 'hono';
import { stripeClient } from '../stripe.ts';
import { store } from '../store.ts';
import { layout, esc, formatMoney } from '../views.ts';

export function registerProductRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // POST /account/:id/products — create a product (+ default price) on the
  // connected account.
  // ---------------------------------------------------------------------------
  app.post('/account/:id/products', async (c) => {
    const accountId = c.req.param('id');
    const form = await c.req.formData();
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const priceDollars = Number(form.get('price'));

    if (!name || !Number.isFinite(priceDollars) || priceDollars <= 0) {
      return c.html(
        layout('Error', `<div class="banner err">Name and a positive price are required.</div>
          <p><a class="btn secondary" href="/account/${esc(accountId)}">← Back</a></p>`),
        400,
      );
    }

    // Stripe amounts are in the smallest currency unit (cents for USD).
    const priceInCents = Math.round(priceDollars * 100);

    // --- CREATE THE PRODUCT ON THE CONNECTED ACCOUNT. -----------------------
    // The 2nd arg `{ stripeAccount: accountId }` tells Stripe to perform this
    // create as the connected account. `default_price_data` creates a Price
    // inline and attaches it as the product's default price in one call.
    await stripeClient.products.create(
      {
        name, // PLACEHOLDER: product name from the form.
        description: description || undefined, // optional.
        default_price_data: {
          unit_amount: priceInCents, // amount in cents.
          currency: 'usd', // PLACEHOLDER: set the merchant's currency.
        },
      },
      { stripeAccount: accountId }, // ← act as the connected account.
    );

    // Send them to the public storefront so they can see it listed.
    return c.redirect(`/store/${accountId}`);
  });

  // ---------------------------------------------------------------------------
  // GET /store/:accountId — public storefront for one connected account.
  // ---------------------------------------------------------------------------
  // NOTE: we key the storefront by the Stripe account id for simplicity. In
  // PRODUCTION you'd expose a friendlier, non-Stripe identifier in the URL
  // (e.g. a store slug) and look up the acct_... server-side, so you never leak
  // Stripe ids and can change the underlying account without breaking links.
  app.get('/store/:accountId', async (c) => {
    const accountId = c.req.param('accountId');
    const local = store.getAccount(accountId);

    // --- LIST PRODUCTS ON THE CONNECTED ACCOUNT. ----------------------------
    // Again scoped via `{ stripeAccount: accountId }`. We expand
    // `data.default_price` so each product carries its price inline (otherwise
    // default_price would just be an id we'd have to fetch separately).
    const products = await stripeClient.products.list(
      {
        limit: 20,
        active: true,
        expand: ['data.default_price'],
      },
      { stripeAccount: accountId },
    );

    const items = products.data.length
      ? products.data
          .map((p) => {
            // default_price is expanded to a full Price object (or null).
            const price = p.default_price && typeof p.default_price !== 'string' ? p.default_price : null;
            const amount = price?.unit_amount ?? null;
            const currency = price?.currency ?? 'usd';
            const priceId = price?.id ?? '';
            const canBuy = Boolean(priceId);
            return `
            <div class="card">
              <div class="row">
                <div class="grow">
                  <div style="font-weight:600">${esc(p.name)}</div>
                  ${p.description ? `<div class="muted">${esc(p.description)}</div>` : ''}
                  <div class="mono" style="margin-top:6px">${formatMoney(amount, currency)}</div>
                </div>
                ${
                  canBuy
                    ? `<form method="post" action="/store/${esc(accountId)}/buy/${esc(priceId)}">
                         <button type="submit">Buy</button>
                       </form>`
                    : `<span class="pill warn">No price</span>`
                }
              </div>
            </div>`;
          })
          .join('')
      : `<div class="empty">This store has no products yet.</div>`;

    const body = `
      <p><a href="/">← Dashboard</a> ${local ? `· <a href="/account/${esc(accountId)}">Manage account</a>` : ''}</p>
      <h1>${esc(local?.displayName ?? 'Storefront')}</h1>
      <p class="sub mono">${esc(accountId)}</p>
      ${items}`;

    return c.html(layout(local?.displayName ?? 'Storefront', body));
  });
}

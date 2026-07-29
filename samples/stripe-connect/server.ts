// =============================================================================
// server.ts — main entry point for the Stripe Connect sample.
// =============================================================================
// Boots a Hono app, registers every route module, and serves it via
// @hono/node-server (works under both Node and Bun).
//
// Run it:
//   bun install            (or: npm install)
//   cp .env.example .env    and fill in your Stripe keys
//   bun run dev             (or: npm run start:node)
//
// What lives where:
//   src/stripe.ts            — the single Stripe Client + env validation
//   src/store.ts             — in-memory storage (demo only)
//   src/config.ts            — public base URL / port resolution
//   src/views.ts             — HTML rendering (dark theme)
//   src/routes/accounts.ts   — create V2 accounts, onboarding, status, UI
//   src/routes/products.ts   — create products, public storefront
//   src/routes/checkout.ts   — direct charge + application fee, success/cancel
//   src/routes/subscriptions.ts — bill the connected account (customer_account)
//   src/routes/webhooks.ts   — thin-event + standard-event webhook endpoints
// =============================================================================

import { Hono } from 'hono';
import { serve } from '@hono/node-server';

// Importing this validates STRIPE_SECRET_KEY at boot and constructs the client.
// If the key is missing the process exits here with a helpful message.
import './src/stripe.ts';
import { port } from './src/config.ts';

import { registerAccountRoutes } from './src/routes/accounts.ts';
import { registerProductRoutes } from './src/routes/products.ts';
import { registerCheckoutRoutes } from './src/routes/checkout.ts';
import { registerSubscriptionRoutes } from './src/routes/subscriptions.ts';
import { registerWebhookRoutes } from './src/routes/webhooks.ts';

const app = new Hono();

// A trivial health check (handy when running behind a tunnel/proxy).
app.get('/healthz', (c) => c.text('ok'));

// Register all feature routes. Order doesn't matter — paths don't overlap.
registerAccountRoutes(app);
registerProductRoutes(app);
registerCheckoutRoutes(app);
registerSubscriptionRoutes(app);
registerWebhookRoutes(app);

// Last-resort error handler so a thrown Stripe error renders something useful
// instead of a blank 500. Stripe errors carry a `.message` and often a `.type`.
app.onError((err, c) => {
  console.error('[error]', err);
  const message =
    err instanceof Error ? err.message : 'Unexpected error';
  return c.html(
    `<pre style="color:#ff5d5d;background:#141410;padding:20px;white-space:pre-wrap">${
      message.replace(/</g, '&lt;')
    }</pre><p style="font-family:sans-serif"><a href="/" style="color:#f5a623">← Back to dashboard</a></p>`,
    500,
  );
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n🚀 Stripe Connect sample listening on http://localhost:${info.port}\n`);
});

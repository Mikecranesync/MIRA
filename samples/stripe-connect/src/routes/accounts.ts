// =============================================================================
// src/routes/accounts.ts — connected-account lifecycle.
// Covers spec sections 2 (create V2 account), 3 (onboarding + status),
// and the Dashboard (/) + Account detail (/account/:id) UI pages.
// =============================================================================

import type { Hono } from 'hono';
import { stripeClient } from '../stripe.ts';
import { store } from '../store.ts';
import { rootUrl } from '../config.ts';
import { layout, esc } from '../views.ts';

export function registerAccountRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // GET / — Dashboard: list connected accounts + form to create a new one.
  // ---------------------------------------------------------------------------
  app.get('/', (c) => {
    const accounts = store.listAccounts();

    const rows = accounts.length
      ? accounts
          .map(
            (a) => `
        <tr>
          <td>
            <div>${esc(a.displayName)}</div>
            <div class="mono">${esc(a.id)}</div>
          </td>
          <td class="muted">${esc(a.contactEmail)}</td>
          <td><a class="btn secondary" href="/account/${esc(a.id)}">Manage →</a></td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="3" class="empty">No connected accounts yet. Create one below.</td></tr>`;

    const body = `
      <h1>Connected accounts</h1>
      <p class="sub">Each connected account is a merchant onboarded onto your platform.</p>

      <div class="card">
        <table>
          <thead><tr><th>Account</th><th>Email</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <h2>Create a connected account</h2>
      <div class="card">
        <form method="post" action="/accounts">
          <label for="display_name">Business / merchant name</label>
          <input id="display_name" name="display_name" required placeholder="Acme Coffee Co." />
          <label for="contact_email">Contact email</label>
          <input id="contact_email" name="contact_email" type="email" required placeholder="owner@acme.example" />
          <div style="margin-top:14px"><button type="submit">Create account</button></div>
        </form>
      </div>`;

    return c.html(layout('Dashboard', body));
  });

  // ---------------------------------------------------------------------------
  // POST /accounts — create a connected account using the V2 Core API.
  // ---------------------------------------------------------------------------
  app.post('/accounts', async (c) => {
    const form = await c.req.formData();
    const displayName = String(form.get('display_name') ?? '').trim();
    const contactEmail = String(form.get('contact_email') ?? '').trim();

    if (!displayName || !contactEmail) {
      return c.html(layout('Error', errorCard('Both name and email are required.')), 400);
    }

    // --- THE V2 CONNECTED-ACCOUNT CREATE CALL. ------------------------------
    // We use ONLY the V2 Core Accounts API. We do NOT pass a top-level
    // `type: 'express' | 'standard' | 'custom'` — those are the legacy V1
    // account "types". In V2 the account's behaviour is described by its
    // `configuration` (customer / merchant) and `dashboard` access instead.
    const account = await stripeClient.v2.core.accounts.create({
      // display_name: shown in the Stripe dashboard / emails for this account.
      display_name: displayName, // PLACEHOLDER: collected from the create form.
      // contact_email: where Stripe sends account-related email.
      contact_email: contactEmail, // PLACEHOLDER: collected from the create form.
      // identity.country: the merchant's country (ISO 3166-1 alpha-2, lowercase).
      identity: { country: 'us' }, // PLACEHOLDER: set to the merchant's real country.
      // dashboard: 'full' gives the connected account access to a full Stripe
      // Dashboard login (the closest V2 analogue to a "standard" experience).
      dashboard: 'full',
      // defaults.responsibilities: who collects fees and absorbs losses.
      // 'stripe' here means the platform's standard Connect handling applies.
      defaults: {
        responsibilities: {
          fees_collector: 'stripe',
          losses_collector: 'stripe',
        },
      },
      // configuration: which "configurations" this account is enabled for.
      //   - customer: lets the account BE billed (used for the subscription demo).
      //   - merchant: lets the account ACCEPT payments; we request card_payments.
      configuration: {
        customer: {},
        merchant: {
          capabilities: {
            // Request the card_payments capability. It starts 'inactive' and
            // becomes 'active' only after onboarding requirements are satisfied.
            card_payments: { requested: true },
          },
        },
      },
    });

    // Persist the local mapping (demo: in memory). The Stripe account stays the
    // source of truth for status; we only remember enough to render the UI.
    store.saveAccount({
      id: account.id,
      displayName,
      contactEmail,
      createdAt: Date.now(),
    });

    // Straight to the account's management page where they can onboard.
    return c.redirect(`/account/${account.id}`);
  });

  // ---------------------------------------------------------------------------
  // GET /account/:id — Account detail: live status + onboard / product /
  // subscription / portal actions.
  // ---------------------------------------------------------------------------
  app.get('/account/:id', async (c) => {
    const id = c.req.param('id');
    const local = store.getAccount(id);

    // --- ALWAYS fetch live status from the API (never trust a cache). -------
    // We `include` the merchant configuration (for capability status) and the
    // requirements summary (for onboarding completeness).
    const account = await stripeClient.v2.core.accounts.retrieve(id, {
      include: ['configuration.merchant', 'requirements'],
    });

    // Can this account actually charge cards yet? The capability must be 'active'.
    const readyToProcessPayments =
      account?.configuration?.merchant?.capabilities?.card_payments?.status === 'active';

    // Is onboarding done? Stripe summarises outstanding requirements with a
    // "minimum_deadline.status". Anything currently_due / past_due means the
    // account still owes Stripe information.
    const requirementsStatus = account.requirements?.summary?.minimum_deadline?.status;
    const onboardingComplete =
      requirementsStatus !== 'currently_due' && requirementsStatus !== 'past_due';

    const statusPill = readyToProcessPayments
      ? `<span class="pill ok">Ready to accept payments</span>`
      : onboardingComplete
        ? `<span class="pill warn">Onboarding complete, capability pending</span>`
        : `<span class="pill err">Onboarding required</span>`;

    const flash = c.req.query('onboarded')
      ? `<div class="banner ok">Returned from Stripe onboarding. Status below is fetched live from the API.</div>`
      : c.req.query('refresh')
        ? `<div class="banner warn">Onboarding link expired or was refreshed — start onboarding again.</div>`
        : '';

    const body = `
      ${flash}
      <h1>${esc(local?.displayName ?? id)}</h1>
      <p class="sub mono">${esc(id)}</p>
      <div class="row" style="margin:8px 0 4px">${statusPill}</div>

      <div class="card">
        <h2 style="margin-top:0">Onboarding</h2>
        <p class="muted">
          Onboarding complete: <strong>${onboardingComplete ? 'yes' : 'no'}</strong> ·
          Card payments: <strong>${esc(account?.configuration?.merchant?.capabilities?.card_payments?.status ?? 'unknown')}</strong>
          ${requirementsStatus ? ` · Requirements: <strong>${esc(requirementsStatus)}</strong>` : ''}
        </p>
        <form method="post" action="/account/${esc(id)}/onboard">
          <button type="submit">Onboard to collect payments</button>
        </form>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Create a product on this account</h2>
        ${
          readyToProcessPayments
            ? ''
            : `<div class="banner warn">You can create products before onboarding finishes, but the account can't be paid until card payments are <code>active</code>.</div>`
        }
        <form method="post" action="/account/${esc(id)}/products">
          <label for="name">Product name</label>
          <input id="name" name="name" required placeholder="Bag of beans" />
          <label for="description">Description</label>
          <input id="description" name="description" placeholder="Single-origin, 12oz" />
          <div class="row" style="gap:10px; margin-top:10px">
            <div class="grow">
              <label for="price">Price (USD)</label>
              <input id="price" name="price" type="number" min="0.50" step="0.01" required placeholder="14.00" />
            </div>
          </div>
          <div style="margin-top:14px"><button type="submit">Create product</button></div>
        </form>
        <p style="margin-top:14px">
          <a class="btn secondary" href="/store/${esc(id)}">View public storefront →</a>
        </p>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Platform subscription</h2>
        <p class="muted">Bill THIS connected account for a recurring platform plan
          (uses <code>customer_account</code>).</p>
        <div class="row" style="gap:10px">
          <form method="post" action="/account/${esc(id)}/subscribe">
            <button type="submit">Subscribe this account</button>
          </form>
          <form method="post" action="/account/${esc(id)}/portal">
            <button class="btn secondary" type="submit">Open billing portal</button>
          </form>
        </div>
      </div>`;

    return c.html(layout(local?.displayName ?? 'Account', body));
  });

  // ---------------------------------------------------------------------------
  // POST /account/:id/onboard — create a V2 Account Link and redirect to it.
  // ---------------------------------------------------------------------------
  app.post('/account/:id/onboard', async (c) => {
    const id = c.req.param('id');
    const root = rootUrl(c);

    // --- CREATE A V2 ACCOUNT LINK (hosted onboarding). ----------------------
    // The account link is a one-time, short-lived URL that takes the merchant
    // through Stripe-hosted onboarding for the requested configurations.
    const accountLink = await stripeClient.v2.core.accountLinks.create({
      // account: which connected account this onboarding flow is for.
      account: id,
      use_case: {
        // type: 'account_onboarding' = collect the info Stripe needs to enable
        // the requested capabilities (vs. 'account_update' for later edits).
        type: 'account_onboarding',
        account_onboarding: {
          // configurations: onboard for both merchant (accept payments) and
          // customer (be billed) so this one account works for every demo here.
          configurations: ['merchant', 'customer'],
          // refresh_url: where Stripe sends the user if the link expires or is
          // revisited — we send them back here to mint a fresh link.
          refresh_url: `${root}/account/${id}?refresh=1`, // PLACEHOLDER: your refresh URL.
          // return_url: where Stripe sends the user when onboarding is done.
          // We tag the account id so the detail page can show "you're back".
          return_url: `${root}/account/${id}?onboarded=1`, // PLACEHOLDER: your return URL.
        },
      },
    });

    // The hosted onboarding URL lives on the returned link object.
    return c.redirect(accountLink.url);
  });
}

function errorCard(message: string): string {
  return `<div class="banner err">${esc(message)}</div><p><a class="btn secondary" href="/">← Back to dashboard</a></p>`;
}

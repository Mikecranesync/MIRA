// =============================================================================
// src/stripe.ts — the single Stripe Client used by the whole app.
// =============================================================================
// "Stripe Client" pattern: we construct ONE `Stripe` instance here and import
// `stripeClient` everywhere else. Every Stripe API call in this sample goes
// through `stripeClient.*` — never a bare `stripe.xxx`. Centralizing it means:
//   - one place to read the secret key,
//   - one place to pin the API version / app info,
//   - helpful, fail-fast errors when configuration is missing.
// =============================================================================

import Stripe from 'stripe';

/**
 * Read a required environment variable, or throw a helpful error explaining
 * exactly what is missing and where to set it. We fail fast at boot rather
 * than deep inside a request handler where the error would be confusing.
 */
export function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '' || value.endsWith('PLACEHOLDER')) {
    throw new Error(
      `\n\n❌ Missing required env var: ${name}\n` +
        `   ${hint}\n` +
        `   → Copy .env.example to .env and fill it in. See the README.\n`,
    );
  }
  return value;
}

/**
 * Read an optional env var with a fallback.
 */
export function optionalEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' && !value.endsWith('PLACEHOLDER') ? value : fallback;
}

// --- The platform secret key. ----------------------------------------------
// This is YOUR (the platform's) secret key. It authenticates every call below.
// Connected-account calls add a `stripeAccount` header (or use `customer_account`
// / `account` properties) to act ON BEHALF OF a connected account.
const STRIPE_SECRET_KEY = requireEnv(
  'STRIPE_SECRET_KEY',
  'Your platform account secret key (sk_test_... while developing).',
);

// --- Construct the one Stripe Client. ---------------------------------------
// We deliberately do NOT pin `apiVersion` here: the installed SDK ships with a
// default API version that matches the V2 Core (`v2.core.accounts`, thin
// events, `customer_account`) features this sample uses. Pinning an older
// version would disable those V2 surfaces.
// PLACEHOLDER: if your Stripe account is pinned to a specific API version and
// you see "unknown parameter" errors on the V2 calls, set `apiVersion` to a
// version that supports V2 Core Accounts.
export const stripeClient = new Stripe(STRIPE_SECRET_KEY, {
  // appInfo is optional but recommended — it tags API requests so Stripe
  // support can see they came from this sample. Cosmetic only.
  appInfo: {
    name: 'stripe-connect-sample',
    version: '1.0.0',
  },
});

// Quick sanity log so it's obvious which mode you're in at boot.
const mode = STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE 🔴' : 'TEST 🟢';
console.log(`[stripe] Client initialised in ${mode} mode.`);

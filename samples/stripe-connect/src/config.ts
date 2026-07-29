// =============================================================================
// src/config.ts — resolves the public base URL used to build Stripe redirect
// URLs (onboarding refresh/return, Checkout success/cancel, portal return).
// =============================================================================

import type { Context } from 'hono';
import { optionalEnv } from './stripe.ts';

const PORT = Number(optionalEnv('PORT', '4242'));
export const port = PORT;

/**
 * The root URL Stripe should send the user back to.
 *
 * Order of preference:
 *   1. PUBLIC_BASE_URL env (set this when behind ngrok / a deployed host).
 *   2. Derived from the incoming request's Host header (good for localhost).
 *
 * Stripe needs a real, reachable URL for return/refresh/success/cancel. On
 * localhost the derived value (http://localhost:4242) works for the redirect
 * back, but note that Stripe-initiated *webhooks* still need a public tunnel
 * (the Stripe CLI handles that locally — see the README).
 */
export function rootUrl(c: Context): string {
  const fromEnv = optionalEnv('PUBLIC_BASE_URL');
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  // Fall back to the request's own origin.
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

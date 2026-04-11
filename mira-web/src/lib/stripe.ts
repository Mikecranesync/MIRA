/**
 * Stripe integration — Checkout sessions, billing portal, webhook verification.
 *
 * Env vars (Doppler):
 *   STRIPE_SECRET_KEY    — Stripe API secret
 *   STRIPE_WEBHOOK_SECRET — Webhook endpoint signing secret (whsec_...)
 *   STRIPE_PRICE_ID      — Price ID for $97/mo beta subscription
 */

import Stripe from "stripe";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  _stripe = new Stripe(key, { apiVersion: "2025-03-31.basil" });
  return _stripe;
}

const BASE_URL = () =>
  process.env.PUBLIC_URL || "https://factorylm.com";

/**
 * Create a Stripe Checkout session for $97/mo beta subscription.
 * Returns the Checkout URL for redirect.
 */
export async function createCheckoutSession(
  tenantId: string,
  email: string
): Promise<string> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID not set");

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    metadata: { tenant_id: tenantId },
    subscription_data: {
      metadata: { tenant_id: tenantId },
    },
    success_url: `${BASE_URL()}/cmms?payment=success`,
    cancel_url: `${BASE_URL()}/cmms?payment=cancelled`,
  });

  if (!session.url) throw new Error("Stripe session created without URL");
  return session.url;
}

/**
 * Create a Stripe Customer Portal session for subscription management.
 * Returns the portal URL for redirect.
 */
export async function createPortalSession(
  stripeCustomerId: string
): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${BASE_URL()}/cmms`,
  });
  return session.url;
}

/**
 * Verify and construct a Stripe webhook event from raw body + signature.
 */
export function constructWebhookEvent(
  rawBody: string,
  signature: string
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");

  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

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
 *
 * Accounts V2 (Stripe's newer account architecture) rejects Checkout sessions
 * that pass `customer_email` alone in test mode — the Customer must exist
 * before the session is created. We reuse an existing Customer if one with
 * the same email is found, otherwise create one, then pass `customer: id`.
 * This pattern also works on legacy accounts and in live mode.
 *
 * Returns the Checkout URL for redirect.
 */
export async function createCheckoutSession(
  tenantId: string,
  email: string
): Promise<string> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID not set");

  const stripe = getStripe();

  const existing = await stripe.customers.list({ email, limit: 1 });
  const customerId =
    existing.data[0]?.id ??
    (
      await stripe.customers.create({
        email,
        metadata: { tenant_id: tenantId },
      })
    ).id;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
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
 * Create a Stripe Checkout session without a pre-existing customer.
 * Stripe collects email + card on its own hosted page.
 * Used for direct "Buy Now" buttons on the pricing page.
 */
export async function createDirectCheckoutSession(): Promise<string> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID not set");

  const stripe = getStripe();
  const base = BASE_URL();

  // Accounts V2 (new Stripe accounts) rejects customerless Checkout in test mode.
  // Pre-create an anonymous customer so Stripe collects email+card on its hosted page.
  const customer = await stripe.customers.create({
    metadata: { source: "pricing_page_direct" },
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customer.id,
    success_url: "https://app.factorylm.com/feed/?checkout=success",
    cancel_url: `${base}/pricing?checkout=cancelled`,
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error("Stripe session created without URL");
  return session.url;
}

/**
 * Verify and construct a Stripe webhook event from raw body + signature.
 */
export async function constructWebhookEvent(
  rawBody: string,
  signature: string
): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");

  const stripe = getStripe();
  // Use async version — Bun's SubtleCrypto doesn't support sync HMAC
  return await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
}

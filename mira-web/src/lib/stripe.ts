/**
 * Stripe integration — Checkout sessions, billing portal, webhook verification.
 *
 * Env vars (Doppler):
 *   STRIPE_SECRET_KEY                — Stripe API secret
 *   STRIPE_WEBHOOK_SECRET            — Webhook endpoint signing secret (whsec_...)
 *   STRIPE_PRICE_ID                  — Price ID for $97/mo beta subscription (CMMS/Hub)
 *   STRIPE_DRIVE_COMMANDER_PRICE_ID  — Price ID for Drive Commander Pro ($197/yr annual,
 *                                      Doppler key factorylm/prd:STRIPE_DRIVE_COMMANDER_PRICE_ID)
 *
 * Drive Commander Pro pricing: $197/yr annual is the lead SKU (locked by Mike 2026-09-05).
 * The Stripe price must be configured as a recurring/annual interval in the Stripe dashboard
 * before setting the env var. Leave STRIPE_DRIVE_COMMANDER_PRICE_ID unset in dev to exercise
 * the graceful fallback to /pricing?product=drive-commander-pro.
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
 * Create a Stripe Checkout session for Drive Commander Pro (individual, $29/mo).
 * Stripe collects email + card on its hosted page; the webhook records the
 * purchase WITHOUT running CMMS tenant activation or Hub provisioning
 * (different product, different buyer — see the drive-commander-pro branch
 * in /api/stripe/webhook).
 */
export async function createDriveCommanderCheckoutSession(): Promise<string> {
  const priceId = process.env.STRIPE_DRIVE_COMMANDER_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_DRIVE_COMMANDER_PRICE_ID not set");

  const stripe = getStripe();
  const base = BASE_URL();

  // Same Accounts-V2 pattern as createDirectCheckoutSession: pre-create an
  // anonymous customer so Stripe collects email+card on its hosted page.
  const customer = await stripe.customers.create({
    metadata: { source: "drive_commander_funnel" },
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customer.id,
    metadata: { product: "drive-commander-pro" },
    subscription_data: {
      metadata: { product: "drive-commander-pro" },
    },
    // {CHECKOUT_SESSION_ID} is a Stripe template literal — filled in by Stripe on redirect.
    // The server uses session_id to verify the purchase and issue a Pro entitlement cookie.
    success_url: `${base}/drive-commander/siemens-g120?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/drive-commander/siemens-g120?checkout=cancelled`,
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error("Stripe session created without URL");
  return session.url;
}

/**
 * Verify a Drive Commander Pro checkout session and return the customer email.
 * Used on the success redirect (?session_id=cs_xxx) to issue a Pro entitlement
 * cookie without requiring a separate sign-up step.
 *
 * Returns null if the session is not a completed drive-commander-pro purchase.
 * Fail-closed: any error returns null (no Pro granted on uncertainty).
 */
export async function verifyDCProSession(
  sessionId: string,
): Promise<{ email: string; customerId: string; subscriptionId: string } | null> {
  if (!sessionId || !sessionId.startsWith("cs_")) return null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer"],
    });
    if (
      session.payment_status !== "paid" ||
      session.metadata?.product !== "drive-commander-pro"
    ) {
      return null;
    }
    const email = session.customer_details?.email ?? "";
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : (session.customer as { id: string } | null)?.id ?? "";
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : "";
    if (!email) return null;
    return { email, customerId, subscriptionId };
  } catch (err) {
    console.error("[verifyDCProSession] Stripe lookup failed:", err);
    return null;
  }
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

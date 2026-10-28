/**
 * Kill switch for the public, unauthenticated `POST /api/checkout/start`
 * route (mira-web/src/server.ts) while FactoryLM pilots are free (issue
 * #4369 — checkout charges the wrong price and there is no in-product way
 * to pay for the pilot yet).
 *
 * Mike authorized disabling the endpoint reversibly: default OFF (returns
 * HTTP 410 before any rate-limit check, tenant lookup/creation, or Stripe
 * call), restorable at any time by setting PLG_CHECKOUT_ENABLED=1 — no code
 * change, no redeploy of anything but the env var.
 *
 * `/api/stripe/webhook` is untouched by this gate — existing subscriptions
 * must keep renewing/cancelling while the pilot is free.
 *
 * Side-effect-free module (like deploy-identity.ts / hub-origin.ts) so it is
 * unit-testable without importing server.ts.
 */

export function isCheckoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PLG_CHECKOUT_ENABLED;
  return raw === "1" || raw === "true";
}

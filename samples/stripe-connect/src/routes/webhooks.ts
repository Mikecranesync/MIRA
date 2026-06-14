// =============================================================================
// src/routes/webhooks.ts — TWO separate webhook endpoints, because Stripe has
// two different event delivery formats and this sample uses both:
//
//   1. /webhooks/connect       — V2 "THIN EVENTS" for connected-account
//                                 requirements + capability changes (section 4).
//   2. /webhooks/subscriptions — STANDARD V1 events for the subscription
//                                 lifecycle, payment methods, invoices (section 9).
//
// They use DIFFERENT verification APIs and DIFFERENT signing secrets:
//   - thin events:   stripeClient.parseThinEvent(body, sig, secret)
//   - standard:      stripeClient.webhooks.constructEvent(body, sig, secret)
//
// CRITICAL: webhook signature verification needs the EXACT RAW REQUEST BODY.
// We read it with `c.req.text()` and pass the string straight through — never
// JSON.parse it first, or the signature check will fail.
// =============================================================================

import type { Hono } from 'hono';
import type Stripe from 'stripe';
import { stripeClient, requireEnv } from '../stripe.ts';

export function registerWebhookRoutes(app: Hono): void {
  // ===========================================================================
  // 1) V2 THIN-EVENT WEBHOOK — connected account requirements & capabilities.
  // ===========================================================================
  // Local testing with the Stripe CLI (forwards ONLY the thin events we name):
  //
  //   stripe listen \
  //     --thin-events 'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' \
  //     --forward-thin-to localhost:4242/webhooks/connect
  //
  // The CLI prints a `whsec_...` — put it in STRIPE_CONNECT_WEBHOOK_SECRET.
  app.post('/webhooks/connect', async (c) => {
    const webhookSecret = requireEnv(
      'STRIPE_CONNECT_WEBHOOK_SECRET',
      'Signing secret for the thin-event endpoint (from `stripe listen --thin-events ...`).',
    );

    // Raw body + signature header, untouched.
    const body = await c.req.text();
    const sig = c.req.header('stripe-signature') ?? '';

    let notification: Stripe.V2.Core.EventNotification;
    try {
      // Verify the signature and parse the THIN EVENT NOTIFICATION. A thin
      // event carries only the event id/type + a reference to the related
      // object — NOT the full payload.
      //
      // NOTE: older Stripe docs/snippets call this `parseThinEvent(...)`. In the
      // current SDK (stripe-node v22) the method is `parseEventNotification(...)`
      // with the same purpose and signature (payload, signature-header, secret).
      notification = stripeClient.parseEventNotification(body, sig, webhookSecret);
    } catch (err) {
      console.error('[webhook:connect] signature verification failed:', (err as Error).message);
      return c.text('Invalid signature', 400);
    }

    try {
      // Pull the FULL event from the V2 events API using the notification id.
      // This is the recommended pattern: the thin event is just a nudge; you
      // fetch the authoritative, fully-populated event when you need details.
      const event = await stripeClient.v2.core.events.retrieve(notification.id);

      switch (event.type) {
        // Outstanding-requirements set changed (new info due, deadline moved...).
        case 'v2.core.account[requirements].updated': {
          const accountId = event.related_object?.id;
          console.log(`[webhook:connect] requirements.updated for ${accountId}`);
          // Re-fetch live account state to react to it.
          if (accountId) await logAccountState(accountId);
          // TODO(db): persist requirement status; notify the merchant if action
          // is needed (e.g. send them a fresh onboarding link).
          break;
        }

        // The merchant configuration's capability status changed — e.g.
        // card_payments flipped inactive → active (account can now be paid).
        case 'v2.core.account[configuration.merchant].capability_status_updated': {
          const accountId = event.related_object?.id;
          console.log(`[webhook:connect] merchant capability_status_updated for ${accountId}`);
          if (accountId) await logAccountState(accountId);
          // TODO(db): flip your local "can_accept_payments" flag; unlock the
          // merchant's storefront / payout UI.
          break;
        }

        // The customer configuration's capability status changed — affects
        // whether the account can be billed (our subscription demo).
        case 'v2.core.account[configuration.customer].capability_status_updated': {
          const accountId = event.related_object?.id;
          console.log(`[webhook:connect] customer capability_status_updated for ${accountId}`);
          if (accountId) await logAccountState(accountId);
          // TODO(db): flip your local "can_be_billed" flag.
          break;
        }

        default:
          // Other thin events we didn't subscribe to — acknowledge and move on.
          console.log(`[webhook:connect] unhandled thin event: ${event.type}`);
      }
    } catch (err) {
      // Log and still 500 so Stripe retries — but only for genuine processing
      // failures, never for signature failures (those are 400 above).
      console.error('[webhook:connect] processing error:', (err as Error).message);
      return c.text('Processing error', 500);
    }

    // 2xx tells Stripe we received it. Always ack a verified event.
    return c.text('ok', 200);
  });

  // ===========================================================================
  // 2) STANDARD V1-EVENT WEBHOOK — subscriptions, payment methods, invoices.
  // ===========================================================================
  // Local testing with the Stripe CLI (standard events, NOT thin):
  //
  //   stripe listen --forward-to localhost:4242/webhooks/subscriptions
  //
  // The CLI prints a separate `whsec_...` — put it in
  // STRIPE_SUBSCRIPTION_WEBHOOK_SECRET. Trigger test events with e.g.:
  //   stripe trigger customer.subscription.updated
  //   stripe trigger invoice.payment_failed
  app.post('/webhooks/subscriptions', async (c) => {
    const webhookSecret = requireEnv(
      'STRIPE_SUBSCRIPTION_WEBHOOK_SECRET',
      'Signing secret for the standard-event endpoint (from a plain `stripe listen`).',
    );

    const body = await c.req.text();
    const sig = c.req.header('stripe-signature') ?? '';

    let event: Stripe.Event;
    try {
      // constructEvent verifies the signature and returns the FULL standard
      // event with its object inline (no second fetch needed, unlike thin events).
      event = stripeClient.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error('[webhook:subscriptions] signature verification failed:', (err as Error).message);
      return c.text('Invalid signature', 400);
    }

    try {
      switch (event.type) {
        // Subscription changed: upgrades, downgrades, quantity changes,
        // pause/resume, and cancel_at_period_end toggles all arrive here.
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          console.log(
            `[webhook:subscriptions] subscription ${sub.id} updated · status=${sub.status} · cancel_at_period_end=${sub.cancel_at_period_end}`,
          );
          // TODO(db): sync the subscription row — status, current_period_end,
          // quantity, plan/price, pause_collection, cancel_at_period_end.
          break;
        }

        // Subscription fully cancelled (ended, not just scheduled to end).
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          console.log(`[webhook:subscriptions] subscription ${sub.id} deleted (cancelled)`);
          // TODO(db): mark the subscription cancelled; revoke plan access.
          break;
        }

        // A payment method was attached to a customer.
        case 'payment_method.attached': {
          const pm = event.data.object as Stripe.PaymentMethod;
          console.log(`[webhook:subscriptions] payment_method ${pm.id} attached (${pm.type})`);
          // TODO(db): record the default/available payment method for the customer.
          break;
        }

        // A payment method was detached from a customer.
        case 'payment_method.detached': {
          const pm = event.data.object as Stripe.PaymentMethod;
          console.log(`[webhook:subscriptions] payment_method ${pm.id} detached`);
          // TODO(db): remove the stored payment method reference.
          break;
        }

        // Customer object changed (email, default payment method, metadata...).
        case 'customer.updated': {
          const customer = event.data.object as Stripe.Customer;
          console.log(`[webhook:subscriptions] customer ${customer.id} updated`);
          // TODO(db): sync customer fields you mirror locally.
          break;
        }

        // An invoice was paid — recurring charge succeeded.
        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          console.log(
            `[webhook:subscriptions] invoice ${invoice.id} paid · amount_paid=${invoice.amount_paid}`,
          );
          // TODO(db): extend the subscription's paid-through date; record revenue.
          break;
        }

        // An invoice payment failed — dunning / past-due handling.
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          console.log(`[webhook:subscriptions] invoice ${invoice.id} payment FAILED`);
          // TODO(db): flag the account past_due; trigger a dunning email.
          break;
        }

        default:
          console.log(`[webhook:subscriptions] unhandled event: ${event.type}`);
      }
    } catch (err) {
      console.error('[webhook:subscriptions] processing error:', (err as Error).message);
      return c.text('Processing error', 500);
    }

    return c.text('ok', 200);
  });
}

/**
 * Helper: fetch the live V2 account state and log the bits that matter for
 * onboarding/capabilities. Demonstrates re-fetching after a thin event.
 */
async function logAccountState(accountId: string): Promise<void> {
  try {
    const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.merchant', 'requirements'],
    });
    const cardStatus = account?.configuration?.merchant?.capabilities?.card_payments?.status;
    const reqStatus = account.requirements?.summary?.minimum_deadline?.status;
    console.log(`           ↳ card_payments=${cardStatus} · requirements=${reqStatus}`);
  } catch (err) {
    console.error('           ↳ could not re-fetch account:', (err as Error).message);
  }
}

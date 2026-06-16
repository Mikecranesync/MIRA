/**
 * Server-side PostHog capture for the PLG funnel.
 *
 * Mirrors the client-side wiring in /posthog-init.js (issue #618 / PR #630):
 * reads `PLG_POSTHOG_KEY` and `PLG_POSTHOG_HOST` from env, no-ops silently
 * when the key is unset so dev/staging deploys never page on missing telemetry.
 *
 * Fire-and-forget: callers MUST `void`-prefix and never await this. The HTTP
 * call is best-effort; any error is swallowed and logged once. PostHog being
 * down or slow MUST NOT impact a checkout or chat request.
 *
 * Funnel (5 stages — see /Users/factorylm/.claude/plans/purring-napping-horizon.md):
 *   1. register_submitted    — POST /api/register success
 *   2. checkout_started      — GET  /api/checkout redirect to Stripe
 *   3. checkout_completed    — POST /api/stripe/webhook subscription.created
 *   4. activation_completed  — POST /api/stripe/webhook after finalizeActivation OK
 *   5. chat_sent             — POST /api/mira/chat   (PostHog filters "first occurrence per user" → first_chat_sent)
 */

const POSTHOG_KEY = (process.env.PLG_POSTHOG_KEY || "").trim();
const POSTHOG_HOST = (process.env.PLG_POSTHOG_HOST || "https://us.i.posthog.com").trim();

let warnedOnce = false;

export type FunnelEvent =
  | "register_submitted"
  | "checkout_started"
  | "checkout_completed"
  | "activation_completed"
  | "chat_sent";

export interface CaptureInput {
  event: FunnelEvent;
  /** Stable per-user id. Tenant id when known, else email, else "anonymous-<ip>". */
  distinctId: string;
  properties?: Record<string, unknown>;
}

export function captureServerEvent({ event, distinctId, properties }: CaptureInput): void {
  if (!POSTHOG_KEY) return;
  if (!distinctId) return;

  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event,
    distinct_id: distinctId,
    properties: { $lib: "mira-web-server", ...properties },
    timestamp: new Date().toISOString(),
  });

  fetch(`${POSTHOG_HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch((err) => {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn("[posthog-server] capture failed (further errors silenced):", err?.message ?? err);
    }
  });
}

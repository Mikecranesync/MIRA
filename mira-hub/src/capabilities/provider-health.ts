/**
 * Provider health + honest exhaustion (D6).
 *
 * WHY. When every provider in the cascade fails, the technician saw "No answer
 * provider available." — true, useless, and silent about WHY. Meanwhile a
 * provider that answers 401/402/403 (bad key, out of credit, forbidden) was
 * re-tried on every single turn, paying a round-trip and a timeout for an
 * answer that cannot change until a human fixes the key or the billing.
 *
 * Two small things, one module:
 *
 *   1. A per-process health cache. A provider that returns an AUTH/BILLING
 *      status is marked unhealthy for `MIRA_PROVIDER_UNHEALTHY_S` seconds
 *      (default 300) and skipped by the cascade until the window expires.
 *      Only 401/402/403 quarantine — a 429 or 5xx is transient and the next
 *      turn may well succeed, so those are NOT cached. A window, not a latch:
 *      the fix (new key, topped-up balance) takes effect within the window
 *      with no restart.
 *
 *   2. An honest final status frame. The route records every attempt's
 *      failure ({provider, httpStatus, reason}) and, when nothing served,
 *      sends an `error` status with a technician-readable message plus the
 *      machine-readable `reason` and `providers` list — additive fields on
 *      the existing frame, so no client changes and no new frame kind. One
 *      structured log line carries the same list for the on-call grep.
 *
 * Never a second cascade: the provider list, order and request bodies stay in
 * `lib/inference/canonical-cascade.ts`. This module only remembers failures
 * and words the exhaustion.
 */

export const DEFAULT_UNHEALTHY_S = 300;

/** Statuses that mean "retrying will not help until a human acts". */
export const QUARANTINE_STATUSES: ReadonlySet<number> = new Set([401, 402, 403]);

/** One failed attempt in the cascade, in order. Never carries message text. */
export type ProviderAttemptFailure = {
  provider: string;
  /** HTTP status when the provider answered at all; null for a thrown error or a skip. */
  httpStatus: number | null;
  /** Short classifier: `http_error`, `empty_stream`, `quarantined`, or the thrown error's name. */
  reason: string;
};

/** The `MIRA_PROVIDER_UNHEALTHY_S` window in ms; `||` because compose delivers an empty string. */
export function unhealthyWindowMs(): number {
  const raw = Number(process.env.MIRA_PROVIDER_UNHEALTHY_S || DEFAULT_UNHEALTHY_S);
  return (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_UNHEALTHY_S) * 1000;
}

export class ProviderHealth {
  private readonly until = new Map<string, number>();

  constructor(private readonly clock: () => number = Date.now) {}

  /**
   * Record a failed attempt. Returns true when the status quarantines the
   * provider (401/402/403); every other failure is remembered nowhere, because
   * it may not repeat.
   */
  markFailed(provider: string, httpStatus: number | null): boolean {
    if (httpStatus === null || !QUARANTINE_STATUSES.has(httpStatus)) return false;
    this.until.set(provider, this.clock() + unhealthyWindowMs());
    return true;
  }

  /** True while the provider is inside its quarantine window. Expiry is lazy. */
  isUnhealthy(provider: string): boolean {
    const until = this.until.get(provider);
    if (until === undefined) return false;
    if (this.clock() >= until) {
      this.until.delete(provider);
      return false;
    }
    return true;
  }

  /** A provider that answered is healthy again at once (a key fix mid-window). */
  markHealthy(provider: string): void {
    this.until.delete(provider);
  }

  reset(): void {
    this.until.clear();
  }
}

let singleton: ProviderHealth | null = null;

/** One cache per process — that is the point: the NEXT turn benefits. */
export function providerHealth(): ProviderHealth {
  if (!singleton) singleton = new ProviderHealth();
  return singleton;
}

export function resetProviderHealthForTests(): void {
  singleton = null;
}

/**
 * Technician-facing copy for a turn no provider could serve. Phone-readable,
 * says what to do, and does not pretend the answer was "not found".
 */
export const ALL_PROVIDERS_FAILED_MESSAGE =
  "I couldn't reach an answer service just now, so this question wasn't answered. " +
  "Nothing was lost — try again in a minute. If it keeps happening, your admin needs to check the AI provider keys.";

export const NO_PROVIDER_CONFIGURED_MESSAGE =
  "No AI answer provider is configured for this workspace yet, so this question wasn't answered. " +
  "Your admin needs to add a provider key.";

/** #4374 post-cap F1: a keyed provider refused by its run-budget cap. */
export const BUDGET_EXHAUSTED_MESSAGE =
  "The AI answer service has reached its usage limit for now, so this question wasn't answered. " +
  "Try again later, or ask your admin to raise the limit.";

export type ProviderExhaustionReason = "all_providers_failed" | "no_provider_configured" | "budget_exhausted";

/** The technician copy for each exhaustion reason — live frame, replay, and hydration share it. */
export const PROVIDER_EXHAUSTION_COPY: Record<ProviderExhaustionReason, string> = {
  all_providers_failed: ALL_PROVIDERS_FAILED_MESSAGE,
  no_provider_configured: NO_PROVIDER_CONFIGURED_MESSAGE,
  budget_exhausted: BUDGET_EXHAUSTED_MESSAGE,
};

/**
 * The additive fields the final `status: "error"` frame carries on provider
 * exhaustion. `providers` is the attempt record in cascade order so the client
 * (or a human reading the SSE) can see 402 vs timeout without server logs.
 */
export function providerExhaustionStatus(failures: ProviderAttemptFailure[]): {
  message: string;
  reason: ProviderExhaustionReason;
  providers: ProviderAttemptFailure[];
} {
  // Budget only when every attempt was a budget refusal: a real provider
  // failure alongside it is still "all providers failed".
  const reason: ProviderExhaustionReason =
    failures.length === 0
      ? "no_provider_configured"
      : failures.every((f) => f.reason === "budget_exhausted")
        ? "budget_exhausted"
        : "all_providers_failed";
  return {
    message: PROVIDER_EXHAUSTION_COPY[reason],
    reason,
    providers: failures,
  };
}

/**
 * One structured line per exhausted turn. Never the question or any answer
 * text — only which providers failed how, so an incident grep answers
 * "is it the key, the balance, or the network" in one line.
 */
export function logProvidersExhausted(
  scope: { tenantId: string; notebookId: string },
  failures: ProviderAttemptFailure[],
): void {
  console.error(
    JSON.stringify({
      service: "mira-hub",
      component: "notebook-chat",
      event: "providers.exhausted",
      tenantId: scope.tenantId,
      notebookId: scope.notebookId,
      reason: providerExhaustionStatus(failures).reason,
      providers: failures,
    }),
  );
}

/**
 * Canonical inference seam for the Hub (TypeScript binding of the MIRA-1000
 * P0002 provider seam).
 *
 * WHY THIS EXISTS — runtime duplication, not a new runtime.
 *
 * There are two MIRA implementations (`docs/architecture/mira-1000/
 * P0004_IMPLEMENTATION_MAP.md` §1). Technicians reach the TypeScript one: the
 * Hub notebook-chat route. That route defined its OWN provider cascade inline,
 * which had drifted from the canonical Python cascade in two ways that matter:
 *
 *   1. It listed **Gemini** as the third provider. Root CLAUDE.md Hard
 *      Constraint #2 is Groq → Cerebras → **Together**. Two cascades, two
 *      answers to "which provider serves a technician" (map §10 Q4).
 *   2. It never asked providers for usage (`stream_options.include_usage` was
 *      absent), so **no turn on the technician path had any token or cost
 *      telemetry at all** — while ADR-0037 gates Cloud Gold on exactly that.
 *
 * This module is ONE definition of the cascade for the Hub, matching
 * `mira-bots/shared/inference/router.py` in order, env-var names, and model
 * defaults. It is not a second engine: no prompt building, no retrieval, no
 * citation logic, no persistence. It selects a provider, streams deltas back to
 * the caller unchanged, and reports what the turn cost.
 *
 * The usage shape deliberately mirrors migration 078's columns
 * (`decision_traces.provider/route_reason/input_tokens/cached_input_tokens/
 * output_tokens/cost_usd_estimate/status`) so the NEXT slice can persist it
 * without redesigning the record. Emitting it is this slice; storing it is not.
 */

/** One provider attempt, in canonical cascade order. */
export type CanonicalProvider = {
  name: string;
  url: string;
  key?: string;
  model: string;
  /** Provider-specific body extras (e.g. Groq reasoning_effort). */
  extra?: Record<string, unknown>;
};

/**
 * Per-turn spend record. Field names mirror migration 078 columns so this maps
 * 1:1 onto `decision_traces` when persistence lands.
 */
export type TurnUsage = {
  provider: string | null;
  model: string | null;
  /** Why THIS provider served: `primary`, or `fallback:<failed>,<failed>`. */
  routeReason: string;
  inputTokens: number | null;
  /** Cached prefix tokens, billed ~0.1x. Separate so spend is not overstated. */
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsdEstimate: number | null;
  /** Provider-call status — NOT the troubleshooting outcome (078 comment). */
  status: "ok" | "empty" | "error" | "capped";
  /** Providers that failed before one served, in order. */
  attempted: string[];
};

/**
 * Published per-Mtok prices, used ONLY to estimate. A wrong-but-declared number
 * is more useful than silence, but it must never be mistaken for billing truth
 * — hence `costUsdEstimate`, and `null` when a provider is unpriced rather than
 * a fabricated 0 (0 would read as "this turn was free").
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  Groq: { input: 0.15, output: 0.75 },
  Cerebras: { input: 0.1, output: 0.6 },
  Together: { input: 0.88, output: 0.88 },
};

/** Cached input is billed at ~10% of the input rate across these providers. */
const CACHED_INPUT_DISCOUNT = 0.1;

/**
 * Per-turn ceiling. A runaway turn is a cost incident, and the zero-token
 * architecture rule requires a declared bound rather than an open tap.
 * Counts OUTPUT tokens, which are the expensive half and the ones a loop grows.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4000;

export function maxOutputTokens(): number {
  const raw = Number(process.env.MIRA_TURN_MAX_OUTPUT_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Is the canonical seam active? Default OFF — the pre-existing inline cascade
 * remains the production path until this is switched on deliberately.
 */
export function canonicalSeamEnabled(): boolean {
  return process.env.MIRA_CANONICAL_SEAM === "1";
}

/**
 * The canonical cascade: Groq → Cerebras → Together (Hard Constraint #2).
 *
 * Gemini is deliberately ABSENT. Env-var names and model defaults match
 * `mira-bots/shared/inference/router.py` so the two runtimes cannot silently
 * serve different models for the same question.
 */
export function canonicalProviders(): CanonicalProvider[] {
  return [
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      // gpt-oss spends the completion budget on hidden reasoning, which
      // truncated broad answers mid-list. Same setting the inline cascade used.
      extra: { reasoning_effort: process.env.GROQ_REASONING_EFFORT ?? "low" },
    },
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_MODEL ?? "gpt-oss-120b",
    },
    {
      name: "Together",
      url: "https://api.together.xyz/v1/chat/completions",
      key: process.env.TOGETHERAI_API_KEY,
      model: process.env.TOGETHERAI_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
  ];
}

export function estimateCostUsd(
  provider: string,
  inputTokens: number | null,
  cachedInputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const price = PRICE_PER_MTOK[provider];
  // Unpriced provider → null, never 0. See PRICE_PER_MTOK.
  if (!price) return null;
  const fresh = Math.max(0, (inputTokens ?? 0) - (cachedInputTokens ?? 0));
  const cost =
    (fresh / 1_000_000) * price.input +
    ((cachedInputTokens ?? 0) / 1_000_000) * price.input * CACHED_INPUT_DISCOUNT +
    ((outputTokens ?? 0) / 1_000_000) * price.output;
  // 6dp matches NUMERIC(12,6) in migration 078.
  return Number(cost.toFixed(6));
}

/** OpenAI-compatible usage block, as returned by all three providers. */
type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

export function usageFromRaw(
  provider: string,
  model: string,
  raw: RawUsage | null | undefined,
  routeReason: string,
  attempted: string[],
  status: TurnUsage["status"] = "ok",
): TurnUsage {
  const inputTokens = raw?.prompt_tokens ?? null;
  const cachedInputTokens = raw?.prompt_tokens_details?.cached_tokens ?? null;
  const outputTokens = raw?.completion_tokens ?? null;
  return {
    provider,
    model,
    routeReason,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costUsdEstimate: estimateCostUsd(provider, inputTokens, cachedInputTokens, outputTokens),
    status,
    attempted,
  };
}

/** Usage for a turn no provider served. Not an error to be swallowed. */
export function exhaustedUsage(attempted: string[]): TurnUsage {
  return {
    provider: null,
    model: null,
    routeReason: attempted.length ? `exhausted:${attempted.join(",")}` : "no_provider_configured",
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    costUsdEstimate: null,
    status: "error",
    attempted,
  };
}

/** `primary` when the first configured provider served; otherwise what it fell back from. */
export function routeReasonFor(attempted: string[]): string {
  return attempted.length === 0 ? "primary" : `fallback:${attempted.join(",")}`;
}

/**
 * Request body for one canonical provider call.
 *
 * `stream_options.include_usage` is the load-bearing addition: without it an
 * OpenAI-compatible provider streams deltas and returns NO usage block, which
 * is precisely why the technician path had no cost telemetry. Cerebras and
 * Together honour it; Groq honours it on the OpenAI-compatible route.
 */
export function buildRequestBody(
  provider: CanonicalProvider,
  messages: unknown[],
  maxTokens: number,
): Record<string, unknown> {
  return {
    model: provider.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    temperature: 0.3,
    ...(provider.extra ?? {}),
  };
}

/** Canonical `usage` SSE frame (P0003 `EventType.USAGE`). */
export type NotebookUsageFrame = {
  kind: "usage";
  provider: string | null;
  model: string | null;
  routeReason: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsdEstimate: number | null;
  status: TurnUsage["status"];
};

export function usageFrame(u: TurnUsage): NotebookUsageFrame {
  return {
    kind: "usage",
    provider: u.provider,
    model: u.model,
    routeReason: u.routeReason,
    inputTokens: u.inputTokens,
    cachedInputTokens: u.cachedInputTokens,
    outputTokens: u.outputTokens,
    costUsdEstimate: u.costUsdEstimate,
    status: u.status,
  };
}

/**
 * One structured line per turn, so spend is greppable in container logs before
 * the DB column lands. Never includes the question, the answer, or any excerpt
 * — this is a spend record, not a transcript.
 */
export function logTurnUsage(scope: { tenantId: string; notebookId: string }, u: TurnUsage): void {
  console.log(
    JSON.stringify({
      service: "mira-hub",
      component: "notebook-chat",
      event: "turn.usage",
      seam: "canonical",
      tenantId: scope.tenantId,
      notebookId: scope.notebookId,
      provider: u.provider,
      model: u.model,
      routeReason: u.routeReason,
      inputTokens: u.inputTokens,
      cachedInputTokens: u.cachedInputTokens,
      outputTokens: u.outputTokens,
      costUsdEstimate: u.costUsdEstimate,
      status: u.status,
      attempted: u.attempted,
    }),
  );
}

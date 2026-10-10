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
const OPENAI_SOL_MODEL = "gpt-6.1-sol";

export function canonicalProviders(scope?: "notebook"): CanonicalProvider[] {
  // Reuse #3999's notebook-only opt-in. Unscoped safety judges keep their
  // established registry; a missing candidate key never selects an incumbent.
  if (scope === "notebook" && process.env.MIRA_NOTEBOOK_PROVIDER === "openai") {
    return [{
      name: "OpenAI",
      url: "https://api.openai.com/v1/chat/completions",
      key: process.env.OPENAI_API_KEY,
      model: OPENAI_SOL_MODEL,
    }];
  }
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
  if (!price || inputTokens === null || outputTokens === null) return null;
  const cached = cachedInputTokens ?? 0;
  // #4343: absent/malformed usage is unknown spend, never a free completion.
  // Keep real zero-token usage distinct from a missing usage block.
  if (
    ![inputTokens, outputTokens, cached].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    cached > inputTokens
  ) return null;
  const fresh = inputTokens - cached;
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
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

/** Sol global-endpoint pricing verified against official docs on 2026-10-10. */
function estimateSolCostUsd(raw: RawUsage | null | undefined): number | null {
  const input = raw?.prompt_tokens;
  const output = raw?.completion_tokens;
  const cached = raw?.prompt_tokens_details?.cached_tokens;
  const writes = raw?.prompt_tokens_details?.cache_write_tokens;
  // Sol bills cache writes separately. An omitted breakdown is unknown cost,
  // even when the old compatible API omits that optional field.
  if (input === undefined || output === undefined || cached === undefined || writes === undefined) return null;
  if (![input, output, cached, writes].every(n => Number.isSafeInteger(n) && n >= 0) || cached + writes > input) return null;
  const reasoning = raw?.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && (!Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > output)) return null;
  const longContext = input > 272_000;
  const inputMultiplier = longContext ? 2 : 1;
  // completion_tokens already includes reasoning: do not bill it twice.
  const cost = ((input - cached - writes) * 2 + cached * 0.10 + writes * 2.50) * inputMultiplier / 1_000_000
    + output * (longContext ? 15 : 10) / 1_000_000;
  return Number(cost.toFixed(6));
}

export function usageFromRaw(
  provider: string,
  model: string,
  raw: RawUsage | null | undefined,
  routeReason: string,
  attempted: string[],
  status: TurnUsage["status"] = "ok",
  /** Actual response identity/tier, not the requested configuration. */
  response?: { model?: unknown; service_tier?: unknown },
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
    costUsdEstimate: provider === "OpenAI"
      ? model === OPENAI_SOL_MODEL && response?.model === OPENAI_SOL_MODEL && response?.service_tier === "default"
        ? estimateSolCostUsd(raw) : null
      : estimateCostUsd(provider, inputTokens, cachedInputTokens, outputTokens),
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
  if (provider.name === "OpenAI") {
    if (provider.model !== OPENAI_SOL_MODEL) throw new Error("Unsupported OpenAI candidate model");
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error("Invalid OpenAI completion bound");
    // Sol model tools require Responses. This reuses Chat Completions without
    // tools, preserving product messages and ignoring arbitrary body extras.
    return {
      model: OPENAI_SOL_MODEL,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: Math.min(maxTokens, 128_000),
      reasoning_effort: "medium",
      store: false,
      service_tier: "default",
    };
  }
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

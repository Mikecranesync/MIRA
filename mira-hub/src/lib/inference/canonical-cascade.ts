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
import { openAiPricePerMtok } from "../../capabilities/openai-prices";

/** One provider attempt, in canonical cascade order. */
export type CanonicalProvider = {
  name: string;
  url: string;
  key?: string;
  model: string;
  /** Provider-specific body extras (e.g. Groq reasoning_effort). */
  extra?: Record<string, unknown>;
  /**
   * Request dialect. `openai-reasoning` (OpenAI gpt-5 family) rejects
   * `max_tokens` (wants `max_completion_tokens`) and any non-default
   * `temperature` with HTTP 400 — which would read as an outage and fall
   * through the cascade. Default `openai-compat` is Groq/Cerebras/Together.
   */
  requestStyle?: "openai-compat" | "openai-reasoning";
  /**
   * OpenRouter's `provider` routing block, sent on EVERY request to it by
   * `requestDialectFields` (the one body shaper every consumer uses): route only
   * to hosts that neither train on nor retain prompts. Absent for everyone else.
   */
  providerRouting?: Record<string, unknown>;
};

/**
 * OpenRouter backup tier (owner decision 2026-10-14) — mirrors the Python
 * router (`mira-bots/shared/inference/router.py`): non-reasoning Llama 3.3 70B,
 * and a data policy verified live on 2026-10-14 (both default models have
 * zero-retention hosts).
 */
export const OPENROUTER_TEXT_MODEL = "meta-llama/llama-3.3-70b-instruct";
export const OPENROUTER_ROUTING = { data_collection: "deny", zdr: true } as const;

/**
 * True for a model OpenRouter could serve as Claude. Anthropic is banned from
 * this cascade (PR #610); OpenRouter serves it as `anthropic/...`, through
 * `~anthropic/...-latest` aliases, and through its `openrouter/...` auto-routers.
 * A preset reference (`@preset/x`, alone or as `model@preset/x`) is refused too:
 * the preset chooses its models remotely and can be switched to Claude without
 * any change here (Codex r1 F1 on #4436).
 */
export function openRouterModelRefused(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.includes("anthropic") || m.includes("claude") || m.startsWith("openrouter/") || m.includes("@");
}

/**
 * The OpenRouter member of a cascade, or none: key-gated, and fail-closed on a
 * refused model (the provider is dropped rather than allowed to answer as Claude).
 */
export function openRouterProviders(): Array<CanonicalProvider & { key: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];
  // `||` because compose maps ${OPENROUTER_MODEL:-} to an EMPTY STRING in-container.
  const model = process.env.OPENROUTER_MODEL || OPENROUTER_TEXT_MODEL;
  if (openRouterModelRefused(model)) {
    console.error(`OPENROUTER_MODEL_REFUSED model=${model} — provider left out`);
    return [];
  }
  return [
    {
      name: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key,
      model,
      providerRouting: { ...OPENROUTER_ROUTING },
    },
  ];
}

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
  // Metered. The zero-retention Llama 3.3 70B host the 2026-10-14 live probe
  // landed on (AkashML); OpenRouter picks among hosts, so this is an estimate.
  OpenRouter: { input: 0.2, output: 0.52 },
};

/**
 * OpenAI bills per MODEL and `OPENAI_MODEL` can name any model, so OpenAI is
 * priced by model id — never by the provider name (#4961) — from the ONE shared
 * table in `capabilities/openai-prices.ts`, which the OpenAI spend cap reads
 * too (#4968), so telemetry and the cap cannot drift. A model missing there
 * estimates to null (unpriced), never 0 and never another model's rate.
 */

/**
 * Cached input for the provider-priced entries above is billed at ~10% of the
 * input rate. OpenAI is NOT: each OpenAI model carries its declared
 * `cached_input` rate in the shared table (#5011 F2; gpt-6.1-sol is 5%).
 */
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
 * The canonical cascade: OpenAI → OpenRouter → Groq → Cerebras → Together (Hard
 * Constraint #2, OpenAI added by owner directive 2026-10-11 while Groq is
 * billing-restricted and Cerebras archived; OpenRouter is the backup tier since
 * 2026-10-14 — both key-gated, so unset keys leave the list as before).
 *
 * Gemini is deliberately ABSENT. Env-var names and model defaults match
 * `mira-bots/shared/inference/router.py` so the two runtimes cannot silently
 * serve different models for the same question.
 */
export function canonicalProviders(): CanonicalProvider[] {
  // OpenAI is listed only when its key is set — the same shape as the Python
  // router's _build_providers(), so with no OPENAI_API_KEY this list is
  // byte-identical to the pre-2026-10-11 cascade and every pinned contract on
  // it still holds.
  const openai: CanonicalProvider[] = process.env.OPENAI_API_KEY
    ? [
        {
          name: "OpenAI",
          url: "https://api.openai.com/v1/chat/completions",
          key: process.env.OPENAI_API_KEY,
          // gpt-5.4-mini: the model the paid review lane already proves against
          // this key; the `||` form matters because compose maps ${OPENAI_MODEL:-},
          // which delivers an EMPTY STRING in-container.
          model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
          extra: { reasoning_effort: process.env.OPENAI_REASONING_EFFORT || "low" },
          requestStyle: "openai-reasoning",
        },
      ]
    : [];
  return [
    ...openai,
    ...openRouterProviders(),
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

/** A provider-reported token count: a non-negative safe integer. */
function isTokenCount(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

export function estimateCostUsd(
  provider: string,
  inputTokens: number | null,
  cachedInputTokens: number | null,
  outputTokens: number | null,
  model?: string | null,
): number | null {
  const price =
    provider === "OpenAI"
      ? model
        ? openAiPricePerMtok(model)
        : undefined
      : PRICE_PER_MTOK[provider];
  // Unpriced provider (or unpriced OpenAI model) → null, never 0. See PRICE_PER_MTOK.
  if (!price) return null;
  // Missing or invalid counts → null, never 0 (#4978). A lost usage frame
  // (the route tolerates a failed post-stop drain) leaves the counts null; 0
  // would book a paid turn as free and hide it from tenantSpendSince's
  // `IS NULL` unpriced count (migration 080). Input and output are required;
  // an absent cached count is 0 (prompt_tokens_details is optional), but a
  // present one must be valid and cannot exceed the prompt.
  if (!isTokenCount(inputTokens) || !isTokenCount(outputTokens)) return null;
  const cached = cachedInputTokens ?? 0;
  if (!isTokenCount(cached) || cached > inputTokens) return null;
  const fresh = inputTokens - cached;
  const cachedRate = "cached_input" in price ? price.cached_input : price.input * CACHED_INPUT_DISCOUNT;
  const cost =
    (fresh / 1_000_000) * price.input +
    (cached / 1_000_000) * cachedRate +
    (outputTokens / 1_000_000) * price.output;
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
    costUsdEstimate: estimateCostUsd(provider, inputTokens, cachedInputTokens, outputTokens, model),
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
/**
 * The output-cap / temperature fields for ONE provider, in its request dialect.
 *
 * This is the single place those two fields are shaped. Every registry consumer
 * that builds its own body (asset chat, namespace chat, reports, the semantic
 * safety judge) spreads this instead of writing `max_tokens` inline — with
 * OpenAI first and the free providers down, an inline `max_tokens` /
 * `temperature` is an HTTP 400 on the only funded provider, which the cascade
 * misreads as an outage (Codex F1 on #4349).
 *
 * gpt-5 family: `max_completion_tokens`, no `temperature` (only the default is
 * accepted), and the provider's `extra` (`reasoning_effort`) — the dialect
 * needs it, so it rides here. Compat providers: `max_tokens` + the caller's
 * `temperature`, nothing else (callers add their own gpt-oss extras).
 */
export function requestDialectFields(
  provider: CanonicalProvider,
  maxTokens: number,
  temperature: number,
): Record<string, unknown> {
  const routing = provider.providerRouting ? { provider: provider.providerRouting } : {};
  if (provider.requestStyle === "openai-reasoning") {
    return { max_completion_tokens: maxTokens, ...(provider.extra ?? {}), ...routing };
  }
  return { max_tokens: maxTokens, temperature, ...routing };
}

export function buildRequestBody(
  provider: CanonicalProvider,
  messages: unknown[],
  maxTokens: number,
): Record<string, unknown> {
  // Field order is preserved from before requestDialectFields existed (the
  // contract test pins the exact object) — the dialect fields come after the
  // stream block, and compat providers still spread their `extra` here.
  const dialect = requestDialectFields(provider, maxTokens, 0.3);
  return {
    model: provider.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...dialect,
    ...(provider.requestStyle === "openai-reasoning" ? {} : (provider.extra ?? {})),
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

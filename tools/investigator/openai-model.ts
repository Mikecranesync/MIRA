/**
 * OpenAI synthesis model for the Maintenance Investigator bench harness (BENCH-A).
 *
 * Implements `SynthesisModel` from `mira-hub/src/capabilities/investigator/types.ts`
 * (the shared, fixed contract — not changed here). Request shape follows the
 * working gpt-5.4-mini call already in production in this worktree set:
 * `tools/bench4589/rewrite_queries.py` (T-1 rewrite bench) — same model family,
 * same "no temperature param" + `max_completion_tokens` shape. `response_format`
 * is NOT hard-coded to `json_object`: `BASE_SYSTEM_PROMPT` (the H0 arm's system
 * prompt) never asks for JSON, and OpenAI rejects a json_object request whose
 * messages don't mention JSON. H1/H2's structured `SynthesisOutput` DOES need
 * JSON, so the caller (run_cases.ts) passes `responseFormat: "json_object"` for
 * those arms and `"text"` for H0 (single_pass.ts).
 *
 * $0 paid-inference hard rule: this class is NEVER invoked by any test in this
 * lane. Tests inject a fake `SynthesisModel` (per types.ts's own doc comment:
 * "tests inject a fake") or exercise this class's request-building/response-
 * parsing logic with a mocked `fetchImpl` — never a real network call.
 */

import type { SynthesisModel } from "@/capabilities/investigator/types";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export interface OpenAiSynthesisModelOptions {
  /** Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string;
  /** Defaults to `process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL`. */
  model?: string;
  /**
   * H1/H2 (structured `SynthesisOutput`) need `"json_object"`. H0 (free-text,
   * `BASE_SYSTEM_PROMPT`) must pass `"text"` — OpenAI 400s a json_object
   * request whose prompt never says "JSON". Required, not defaulted, so a
   * caller can't silently get the wrong mode.
   */
  responseFormat: "json_object" | "text";
  /** Injection seam for tests — never set in production use. */
  fetchImpl?: typeof fetch;
  /** Base URL override for tests; defaults to the real OpenAI endpoint. */
  baseUrl?: string;
  /** Network-error retry count (NOT retried on a semantic/content failure). Default 2. */
  maxRetries?: number;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `OpenAiSynthesisModel implements SynthesisModel` (types.ts) — the "real
 * provider" injected by the offline runner (run_cases.ts). Tests inject a
 * fake instead; this class itself is exercised only with `fetchImpl` mocked.
 */
export class OpenAiSynthesisModel implements SynthesisModel {
  readonly name = "openai";
  private readonly opts: OpenAiSynthesisModelOptions;

  constructor(opts: OpenAiSynthesisModelOptions) {
    this.opts = opts;
  }

  async complete(req: {
    system: string;
    user: string;
    maxOutputTokens: number;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAiSynthesisModel: OPENAI_API_KEY missing (run under `doppler run -p factorylm -c dev --`)");
    }
    const model = this.opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    const fetchFn = this.opts.fetchImpl ?? fetch;
    const baseUrl = this.opts.baseUrl ?? "https://api.openai.com/v1/chat/completions";
    const maxRetries = this.opts.maxRetries ?? 2;

    // No `temperature` key — gpt-5.4-mini (reasoning family) rejects it, same
    // as tools/bench4589/rewrite_queries.py's working request shape.
    const body: Record<string, unknown> = {
      model,
      max_completion_tokens: req.maxOutputTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    };
    if (this.opts.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetchFn(baseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => "<unreadable body>");
          // Only retry on 5xx (transient); 4xx is a request-shape bug, never retry.
          if (resp.status >= 500 && attempt < maxRetries) {
            lastErr = new Error(`OpenAI ${resp.status}: ${errText.slice(0, 500)}`);
            await sleep(500 * (attempt + 1));
            continue;
          }
          throw new Error(`OpenAI ${resp.status}: ${errText.slice(0, 500)}`);
        }
        const data = (await resp.json()) as OpenAiChatCompletionResponse;
        const choice = data.choices?.[0];
        const text = choice?.message?.content ?? "";
        // gpt-5.x reasoning models can spend the ENTIRE max_completion_tokens
        // budget on hidden reasoning tokens and return empty visible content
        // with finish_reason === "length". Silently returning "" would score
        // as an empty (but "successful") answer — surface it as an error
        // instead so the caller's stop_reason reflects what actually happened.
        if (choice?.finish_reason === "length" && text.trim() === "") {
          throw new Error(
            "OpenAiSynthesisModel: finish_reason=length with empty content — max_completion_tokens was likely consumed by reasoning tokens; raise maxOutputTokens",
          );
        }
        const usage = data.usage ?? {};
        return {
          text,
          inputTokens: Number(usage.prompt_tokens ?? 0),
          outputTokens: Number(usage.completion_tokens ?? 0),
        };
      } catch (err) {
        lastErr = err;
        // Network-level failure (fetch threw) — retry; a thrown Error we
        // constructed above (4xx, length-with-empty-content) is NOT network
        // and should not loop silently.
        const isOurError = err instanceof Error && /^OpenAI (4|5)\d\d:|^OpenAiSynthesisModel:/.test(err.message);
        if (!isOurError && attempt < maxRetries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

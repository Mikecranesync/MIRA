/**
 * Cascade LLM client (non-streaming) for internal classifiers and extractors.
 *
 * Mirrors the OpenAI → Groq → Cerebras → Together cascade (root CLAUDE.md Hard
 * Constraint #2; OpenAI key-gated and leading since 2026-10-11) but returns the
 * full completion as a string. Designed for short structured outputs
 * (JSON-mode classifications) and the public quickstart answer, not long-form
 * streaming chat — that is `lib/inference/canonical-cascade.ts`, whose
 * `requestDialectFields` this module shares so the two cannot drift.
 *
 * Cluster law (CLUSTER.md / global memory): no Anthropic, no Gemini, no
 * LangChain, always cascade. Gemini was removed 2026-09-08 (#3688) — it is a
 * PRD §4 violation, never reintroduce.
 */

import { requestDialectFields, type CanonicalProvider } from "@/lib/inference/canonical-cascade";

interface CascadeProvider {
  name: string;
  url: string;
  key: string | undefined;
  model: string;
  /** See CanonicalProvider — the gpt-5 family needs its own cap/temperature dialect. */
  requestStyle?: CanonicalProvider["requestStyle"];
  extra?: Record<string, unknown>;
}

function defaultProviders(): CascadeProvider[] {
  // OpenAI leads, key-gated, exactly as `canonicalProviders()` does for the
  // streaming cascade (owner directive 2026-10-11). Found missing here by the
  // production E2E smoke: the public quickstart money path answered 503 while
  // the notebook route answered fine. With no OPENAI_API_KEY the list is
  // byte-identical to the pre-existing one.
  const openai: CascadeProvider[] = process.env.OPENAI_API_KEY
    ? [
        {
          name: "OpenAI",
          url: "https://api.openai.com/v1/chat/completions",
          key: process.env.OPENAI_API_KEY,
          // `||` because compose maps ${OPENAI_MODEL:-} to an EMPTY STRING in-container.
          model: process.env.OPENAI_CLASSIFIER_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini",
          extra: { reasoning_effort: process.env.OPENAI_REASONING_EFFORT || "low" },
          requestStyle: "openai-reasoning",
        },
      ]
    : [];
  return [
    ...openai,
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      // Small model preferred for short structured tasks; the 120b used in
      // chat is overkill for relationship extraction.
      model: process.env.GROQ_CLASSIFIER_MODEL ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
    },
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_CLASSIFIER_MODEL ?? process.env.CEREBRAS_MODEL ?? "gpt-oss-120b",
    },
    {
      name: "Together",
      url: "https://api.together.xyz/v1/chat/completions",
      key: process.env.TOGETHERAI_API_KEY,
      model:
        process.env.TOGETHERAI_CLASSIFIER_MODEL ??
        process.env.TOGETHERAI_MODEL ??
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
  ];
}

export interface CascadeMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CascadeResult {
  provider: string;
  content: string;
  durationMs: number;
}

export interface CascadeOpts {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  providers?: CascadeProvider[];
}

async function callOne(
  provider: CascadeProvider,
  messages: CascadeMessage[],
  opts: CascadeOpts,
): Promise<string | null> {
  if (!provider.key) return null;
  // The cap/temperature fields are shaped in ONE place for every cascade
  // consumer: gpt-5 wants `max_completion_tokens` and rejects any
  // `temperature` with HTTP 400 (which would read as an outage); the compat
  // providers take `max_tokens` + `temperature` as before.
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    ...requestDialectFields(provider as CanonicalProvider, opts.maxTokens ?? 600, opts.temperature ?? 0.0),
    stream: false,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  // gpt-oss spends completion tokens on reasoning; low effort keeps short
  // structured outputs inside tight maxTokens caps. Guarded so non-reasoning
  // models never receive an unsupported param.
  if (provider.model.includes("gpt-oss")) body.reasoning_effort = "low";

  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let parsed: { choices?: { message?: { content?: string } }[] };
  try {
    parsed = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  } catch {
    return null;
  }
  return parsed.choices?.[0]?.message?.content ?? null;
}

export async function cascadeComplete(
  messages: CascadeMessage[],
  opts: CascadeOpts = {},
): Promise<CascadeResult | null> {
  const providers = opts.providers ?? defaultProviders();
  const start = Date.now();
  for (const p of providers) {
    const content = await callOne(p, messages, opts);
    if (content) {
      return { provider: p.name, content, durationMs: Date.now() - start };
    }
  }
  return null;
}

/**
 * Cascade LLM client (non-streaming) for internal classifiers and extractors.
 *
 * Mirrors the Groq → Cerebras → Gemini cascade used by /api/assets/[id]/chat
 * but returns the full completion as a string. Designed for short structured
 * outputs (JSON-mode classifications), not long-form chat.
 *
 * Cluster law (CLUSTER.md / global memory): no Anthropic, no LangChain,
 * always cascade.
 */

interface CascadeProvider {
  name: string;
  url: string;
  key: string | undefined;
  model: string;
}

function defaultProviders(): CascadeProvider[] {
  return [
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      // 8B preferred for short structured tasks; the 70B used in chat is
      // overkill for relationship extraction.
      model: process.env.GROQ_CLASSIFIER_MODEL ?? process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
    },
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_CLASSIFIER_MODEL ?? process.env.CEREBRAS_MODEL ?? "llama3.1-8b",
    },
    {
      name: "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_CLASSIFIER_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
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
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    max_tokens: opts.maxTokens ?? 600,
    temperature: opts.temperature ?? 0.0,
    stream: false,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

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

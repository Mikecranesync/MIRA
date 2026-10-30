/**
 * Query rewrite for notebook retrieval (NOTEBOOK_QUERY_REWRITE, default off).
 *
 * A technician's post ("drive trips as soon as the pump loads up, any ideas?")
 * rarely uses the words the manual uses ("Overcurrent", "Current Limit",
 * "P033 Motor OL Current"). The lexical lanes in manual-rag.ts cannot bridge
 * that gap; the vector lane bridges some of it but costs fault-code and
 * parameter questions (2026-10-30: oem-fault 137 → 128, oem-index 86 → 70).
 * This step asks the cascade's lead model to restate the post as 3–6 short
 * search phrases in the manual's vocabulary; manual-rag.ts adds the result as
 * ONE extra OR variant (`rewrittenQuery`). The technician's own words still
 * lead retrieval — the rewrite can add candidates and synonyms, never remove.
 *
 * Measured (docs/evals/2026-10-30-t1-query-rewrite, pre-registered + one
 * post-hoc arm): 45 held-out real forum posts 13 → 16 right pages in the top 5;
 * oem-index 86 → 93; oem-fault 137 → 136; t4-77 69 → 67 (top-6 unchanged,
 * top-1 46 → 49). The T-1 bar (Wilson LB ≥ 70%) is NOT met by this layer.
 *
 * Zero-token rule (5 questions): what varies = every message (novel wording);
 * what is stable = the prompt + model, versioned below; cache = none (a message
 * is seen once); tests = query-rewrite.test.ts; invalidation = any change to
 * PROMPT / model / `maxTokens` reopens the measurement above — the numbers
 * belong to this exact prompt. Cost ≈ 300 in + 40 out tokens ≈ $0.0004 per
 * message on gpt-5.4-mini, inside the existing openAiRunBudget cap.
 *
 * Fail-open: any provider failure, timeout, empty or oversized reply leaves
 * retrieval exactly as it was (`rewritten: null`).
 */

import { cascadeComplete, type CascadeMessage, type CascadeOpts, type CascadeResult } from "@/lib/llm/cascade";

/** Exactly the prompt the 2026-10-30 bench measured (tools/bench4589/rewrite_queries.py). */
export const QUERY_REWRITE_PROMPT =
  "You translate a maintenance technician's forum post into the vocabulary an OEM equipment manual uses, " +
  "so a keyword search over that manual finds the page that answers the post. Output ONLY 3 to 6 short search " +
  "phrases, one per line, no numbering, no explanation, no answer. Use the manual's terms: section titles " +
  "(e.g. 'Fault Descriptions', 'Analog Input Configuration', 'Communication Settings'), parameter names and " +
  "numbers as the manual prints them, fault codes normalised (F081 -> F81 and F081 both), signal and terminal " +
  "names, protocol names. Drop greetings, story, brand names and model numbers; keep the thing being asked.";

/** The bench sent the first 3000 chars of a post and capped the reply at 200 completion tokens. */
export const QUERY_REWRITE_MAX_INPUT_CHARS = 3000;
export const QUERY_REWRITE_MAX_TOKENS = 200;
/** Longer than any real 3–6 phrase reply; a runaway answer is dropped, not searched. */
export const QUERY_REWRITE_MAX_OUTPUT_CHARS = 600;
export const QUERY_REWRITE_TIMEOUT_MS = 6_000;

export type QueryRewriteStatus = "off" | "ran" | "skipped_empty" | "skipped_unchanged" | "failed";

export interface QueryRewrite {
  /** Whitespace-collapsed rewrite to pass as `rewrittenQuery`, or null when retrieval should run unchanged. */
  rewritten: string | null;
  /** What this turn did, for the retrieval trace (like `vectorLane`). */
  status: QueryRewriteStatus;
  provider: string | null;
  durationMs: number;
}

/** Only the exact value "1" enables it — the same contract as NOTEBOOK_HYBRID_RETRIEVAL. */
export function queryRewriteEnabled(): boolean {
  return process.env.NOTEBOOK_QUERY_REWRITE === "1";
}

type Complete = (messages: CascadeMessage[], opts?: CascadeOpts) => Promise<CascadeResult | null>;

/**
 * Rewrite one technician message for manual search. Never throws.
 * `complete` is injectable for tests; production uses the cascade (OpenAI leads).
 */
export async function rewriteForManualSearch(message: string, complete: Complete = cascadeComplete): Promise<QueryRewrite> {
  const start = Date.now();
  if (!queryRewriteEnabled()) return { rewritten: null, status: "off", provider: null, durationMs: 0 };
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return { rewritten: null, status: "skipped_empty", provider: null, durationMs: 0 };
  try {
    const r = await complete(
      [
        { role: "system", content: QUERY_REWRITE_PROMPT },
        { role: "user", content: message.slice(0, QUERY_REWRITE_MAX_INPUT_CHARS) },
      ],
      { maxTokens: QUERY_REWRITE_MAX_TOKENS, temperature: 0, timeoutMs: QUERY_REWRITE_TIMEOUT_MS },
    );
    const durationMs = Date.now() - start;
    const rewritten = (r?.content ?? "").replace(/\s+/g, " ").trim();
    if (!rewritten || rewritten.length > QUERY_REWRITE_MAX_OUTPUT_CHARS) {
      return { rewritten: null, status: "failed", provider: r?.provider ?? null, durationMs };
    }
    if (rewritten.toLowerCase() === text.toLowerCase()) {
      return { rewritten: null, status: "skipped_unchanged", provider: r?.provider ?? null, durationMs };
    }
    return { rewritten, status: "ran", provider: r?.provider ?? null, durationMs };
  } catch (err) {
    console.warn("[query-rewrite] failed (retrieval runs on the original words):", err instanceof Error ? err.message : err);
    return { rewritten: null, status: "failed", provider: null, durationMs: Date.now() - start };
  }
}

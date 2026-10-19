/**
 * Hybrid notebook retrieval (2026-10-17 prod-test item 4): CONNECT the
 * nomic-embed-text vectors that `node-knowledge-ingest.ts` already writes on
 * every v2 chunk (and `/api/health/embedder` already probes) to notebook
 * chat, which today reads BM25 + exact-token lanes only. The two rankings are
 * merged with Reciprocal Rank Fusion — no learned weights, no new provider,
 * no schema change — and the #4469 model-applicability filter still decides
 * admission for every row, whichever lane found it.
 *
 * Flag `NOTEBOOK_HYBRID_RETRIEVAL` defaults OFF. Off, or when the embedder is
 * unreachable, or when the scope holds no vectors, the result is the lexical
 * result byte for byte — the vector lane can only ever ADD candidates and
 * re-order, never remove, and never fail a turn.
 *
 * Embedding contract: the SAME model + dimension the write path uses
 * (`EMBED_MODEL` / `EMBED_DIM` in node-knowledge-ingest.ts — pinned by the
 * parity test), otherwise cosine over `<=>` is meaningless.
 */

export const QUERY_EMBED_MODEL = "nomic-embed-text";
export const QUERY_EMBED_DIM = 768;
const QUERY_EMBED_TIMEOUT_MS = 5000;

/** Default OFF. `1` enables the vector lane + RRF merge in retrieveNodeChunks. */
export function hybridRetrievalEnabled(): boolean {
  return process.env.NOTEBOOK_HYBRID_RETRIEVAL === "1";
}

/**
 * Embed the technician's question with the write path's model. Null on ANY
 * failure (no embedder configured, HTTP error, timeout, wrong dimension) —
 * the caller treats null as "lexical only", never as an error.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const base = process.env.OLLAMA_BASE_URL;
  if (!base || !text.trim()) return null;
  try {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: QUERY_EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { embedding?: unknown };
    const vec = data.embedding;
    if (!Array.isArray(vec) || vec.length !== QUERY_EMBED_DIM || !vec.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return null;
    }
    return vec as number[];
  } catch {
    return null;
  }
}

/** pgvector text literal for a `$n::vector` parameter. */
export function vectorLiteral(vec: readonly number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Reciprocal Rank Fusion of two ranked lists. score(item) = Σ 1 / (k + rank)
 * over the lists it appears in (rank is 1-based). An item in both lists keeps
 * the LEXICAL list's object (its rerank features ride with it). Ties break
 * toward the lexical order, so with an empty vector list the output IS the
 * lexical list. k = 60 is the standard constant (Cormack et al.).
 */
export function rrfMerge<T>(
  lexical: readonly T[],
  vector: readonly T[],
  keyOf: (item: T) => string,
  k = 60,
): T[] {
  if (vector.length === 0) return [...lexical];
  const score = new Map<string, number>();
  const item = new Map<string, T>();
  const lexicalPos = new Map<string, number>();
  lexical.forEach((t, i) => {
    const key = keyOf(t);
    if (item.has(key)) return;
    item.set(key, t);
    lexicalPos.set(key, i);
    score.set(key, 1 / (k + i + 1));
  });
  vector.forEach((t, i) => {
    const key = keyOf(t);
    if (!item.has(key)) item.set(key, t);
    score.set(key, (score.get(key) ?? 0) + 1 / (k + i + 1));
  });
  return [...item.keys()]
    .sort((a, b) => {
      const d = score.get(b)! - score.get(a)!;
      if (d !== 0) return d;
      return (lexicalPos.get(a) ?? Number.MAX_SAFE_INTEGER) - (lexicalPos.get(b) ?? Number.MAX_SAFE_INTEGER);
    })
    .map((key) => item.get(key)!);
}

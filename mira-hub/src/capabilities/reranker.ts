/**
 * Cross-encoder reranker client (CU-RR1, retrieval core spec Phase 3 / L3).
 *
 * The model (cross-encoder/ms-marco-MiniLM-L-6-v2, Apache-2.0) runs in its own container
 * (`mira-reranker/`) because the Hub image cannot load native ONNX Runtime and WebAssembly is
 * too slow (2.5–3.5 s per question measured 2026-10-19). This module is the Hub's only client.
 *
 * Contract (docs/architecture/convergence/units/CU-RR1.md):
 *  - Off unless NOTEBOOK_RERANK=1 AND RERANKER_URL is set.
 *  - ANY failure — no URL, HTTP error, timeout, malformed body, wrong score count, non-finite
 *    score — returns null and logs one reason. The caller then keeps today's order. A reranker
 *    outage can never fail or empty a technician's answer.
 *  - Only passage text already admitted for this caller is sent; no tenant id, no identity.
 */

/** NOTEBOOK_RERANK=1 turns the lane on; anything else is off. */
export function rerankEnabled(): boolean {
  return process.env.NOTEBOOK_RERANK === "1";
}

/** How many of the ordered pool's head are rescored (env NOTEBOOK_RERANK_POOL, 6–100, default 50). */
export function rerankPool(): number {
  // Empty counts as unset: compose forwards `${NOTEBOOK_RERANK_POOL:-}` as "", and Number("") is 0.
  const raw = (process.env.NOTEBOOK_RERANK_POOL ?? "").trim();
  const n = raw === "" ? 50 : Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(6, Math.floor(n))) : 50;
}

/** The service truncates too; trimming here keeps the request small. */
export const RERANK_PASSAGE_CHARS = 2000;
/**
 * How long the Hub waits for the service (env NOTEBOOK_RERANK_TIMEOUT_MS, 200–5000 ms,
 * default 1500). A per-environment knob because CPU speed differs by host: a timeout below
 * the host's real latency silently turns every turn into a fallback (CU-RR1 review r6).
 */
export function rerankTimeoutMs(): number {
  const raw = (process.env.NOTEBOOK_RERANK_TIMEOUT_MS ?? "").trim();
  const n = raw === "" ? 1500 : Number(raw);
  return Number.isFinite(n) ? Math.min(5000, Math.max(200, Math.floor(n))) : 1500;
}

export type RerankFallback = "not_configured" | "http_error" | "timeout" | "malformed" | "network";

/**
 * Score each passage against the query. Returns one finite score per passage, in input order,
 * or null (with a logged reason) — never throws.
 */
/** The one log line for a fallback (kept verbatim so existing greps still match). */
export function logRerankFallback(reason: RerankFallback, detail?: string): void {
  console.warn(`[reranker] reranker_fallback reason=${reason}${detail ? ` ${detail}` : ""}`);
}

export async function rerankScores(
  query: string,
  passages: readonly string[],
  deps: { fetch?: typeof fetch; log?: (reason: RerankFallback, detail?: string) => void } = {},
): Promise<number[] | null> {
  const log = deps.log ?? logRerankFallback;
  const base = process.env.RERANKER_URL;
  if (!base) {
    log("not_configured");
    return null;
  }
  if (passages.length === 0) return [];
  try {
    const res = await (deps.fetch ?? fetch)(`${base.replace(/\/+$/, "")}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.slice(0, 1000),
        passages: passages.map((p) => p.slice(0, RERANK_PASSAGE_CHARS)),
      }),
      signal: AbortSignal.timeout(rerankTimeoutMs()),
    });
    if (!res.ok) {
      log("http_error", `status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { scores?: unknown };
    const scores = body.scores;
    if (
      !Array.isArray(scores) ||
      scores.length !== passages.length ||
      !scores.every((s) => typeof s === "number" && Number.isFinite(s))
    ) {
      log("malformed", `n=${passages.length}`);
      return null;
    }
    return scores as number[];
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    log(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    return null;
  }
}

/** Items sorted by score, highest first; equal scores keep their original order (stable). */
export function orderByScores<T>(items: readonly T[], scores: readonly number[]): T[] {
  return items
    .map((item, i) => ({ item, i, s: scores[i] }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

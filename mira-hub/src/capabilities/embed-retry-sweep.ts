// Bounded, single-flight retry sweep for failed node_attachment embeddings.
//
// When the embedder (Ollama) is down, new chunks are inserted with embedding=NULL
// and stay BM25-only. This sweep periodically selects failed chunks across all
// tenants and attempts to embed them, respecting a circuit breaker (stop on
// first embedder failure in a batch) and single-flight semantics (one sweep
// running at a time, not concurrent duplicates).
//
// Tuning:
// - Initial delay: 60s after server start (embedder may be slow to come up)
// - Repeat interval: 10 min after previous sweep completes
// - Batch size: EMBED_BATCH chunks per SELECT→embed→UPDATE round
// - Circuit break: stop entire sweep if zero vectors embeddable in a batch
//
// Env vars (reused from node-knowledge-ingest.ts):
// - OLLAMA_BASE_URL: embedder endpoint
// - NODE_EMBED_ON_WRITE: kill switch (default "1"; set "0" to disable)

import pool from "@/lib/db";

// Reuse constants from node-knowledge-ingest
const EMBED_MODEL = "nomic-embed-text";
const EMBED_DIM = 768;
const EMBED_BATCH = 16;
const EMBED_ON_WRITE = (process.env.NODE_EMBED_ON_WRITE ?? "1") !== "0";
const EMBED_TIMEOUT_MS = 15000;

type EmbedFailureCode =
  | "embedder_not_configured"
  | "embedder_unavailable"
  | "embedder_http_error"
  | "embedder_timeout"
  | "embedding_dimension_mismatch"
  | "db_permission_denied"
  | "vector_update_failed"
  | "select_failed";

export interface EmbedRetrySweepResult {
  chunks_attempted: number;
  chunks_embedded: number;
  circuit_broken_reason?: EmbedFailureCode;
}

// Single-flight: module-level promise guard ensures only one sweep runs.
let sweepInFlight: Promise<EmbedRetrySweepResult> | null = null;

/**
 * Attempt to embed text with the same model+dim as the query path.
 * Injection point for testing; accepts a function instead of reading env directly.
 */
export async function embedText(
  text: string,
): Promise<{ vec: number[] } | { code: EmbedFailureCode }> {
  const base = process.env.OLLAMA_BASE_URL;
  if (!base) return { code: "embedder_not_configured" };
  try {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!resp.ok) return { code: "embedder_http_error" };
    const data = (await resp.json()) as { embedding?: number[] };
    const vec = data.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
      return { code: "embedding_dimension_mismatch" };
    }
    return { vec };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { code: name === "TimeoutError" ? "embedder_timeout" : "embedder_unavailable" };
  }
}

/**
 * Bounded, single-flight retry sweep for all node_attachment chunks with
 * embedding=NULL across all tenants.
 *
 * Returns immediately with the in-flight result if another sweep is already
 * running. Otherwise starts a new sweep and returns its result.
 *
 * Accepts an optional injected embedFn for testing (default: embedText).
 */
export async function embedRetryAllPending(
  embedFn?: (text: string) => Promise<{ vec: number[] } | { code: EmbedFailureCode }>,
): Promise<EmbedRetrySweepResult> {
  if (sweepInFlight) return sweepInFlight;

  const fn = embedFn || embedText;

  sweepInFlight = (async () => {
    let chunksAttempted = 0;
    let chunksEmbedded = 0;
    let circuitBrokenReason: EmbedFailureCode | undefined;

    try {
      if (!EMBED_ON_WRITE) {
        return {
          chunks_attempted: 0,
          chunks_embedded: 0,
          circuit_broken_reason: undefined,
        };
      }

      let cursor = ""; // cursor-based pagination: id > $cursor

      for (;;) {
        let rows: { id: string; content: string }[] = [];

        try {
          const res = await pool.query<{ id: string; content: string }>(
            `SELECT id::text, content FROM knowledge_entries
              WHERE id > $1 AND source_type = 'node_attachment' AND embedding IS NULL
              ORDER BY id
              LIMIT $2`,
            [cursor, EMBED_BATCH],
          );
          rows = res.rows;
        } catch (err) {
          // SELECT failed; stop the sweep
          const code = (err as { code?: string } | null)?.code;
          circuitBrokenReason = code === "42501" ? "db_permission_denied" : "select_failed";
          break;
        }

        if (rows.length === 0) break; // All done

        // Advance cursor for next batch
        cursor = rows[rows.length - 1].id;

        // Embed with no DB connection held
        const results = await Promise.all(rows.map((r) => fn(r.content)));
        const writable: { id: string; vec: number[] }[] = [];

        for (let i = 0; i < rows.length; i++) {
          const r = results[i];
          if ("vec" in r) {
            writable.push({ id: rows[i].id, vec: r.vec });
          } else {
            circuitBrokenReason ??= r.code; // Keep first failure reason
          }
        }

        chunksAttempted += rows.length;

        if (writable.length === 0) {
          // Embedder produced nothing usable; stop rather than spin
          break;
        }

        // Update the writable vectors
        try {
          for (const w of writable) {
            await pool.query(
              `UPDATE knowledge_entries SET embedding = $2::vector
                WHERE id = $1 AND embedding IS NULL`,
              [w.id, `[${w.vec.join(",")}]`],
            );
          }
          chunksEmbedded += writable.length;
          circuitBrokenReason = undefined; // Clear any transient error
        } catch (err) {
          const code = (err as { code?: string } | null)?.code;
          circuitBrokenReason = code === "42501" ? "db_permission_denied" : "vector_update_failed";
          break;
        }
      }
    } catch (err) {
      // Defense in depth: sweep must never crash
      circuitBrokenReason ??= "select_failed";
    }

    return {
      chunks_attempted: chunksAttempted,
      chunks_embedded: chunksEmbedded,
      circuit_broken_reason: circuitBrokenReason,
    };
  })();

  sweepInFlight
    .finally(() => {
      sweepInFlight = null;
    })
    .catch(() => {
      // Catch any unhandled error; cleanup happens in finally
    });

  return sweepInFlight;
}

/**
 * Start the periodic sweep on server initialization.
 * Initial delay: 60s, then every 10 minutes.
 * Uses .unref() so the timer doesn't prevent process exit.
 */
export function scheduleEmbedRetrySweep(): void {
  // Initial delay: give the embedder time to start up
  const initialTimer = setTimeout(() => {
    embedRetryAllPending().catch((err) => {
      console.error("[embed-retry-sweep] unhandled error in initial sweep", err);
    });

    // Recurring interval: every 10 minutes after that
    const recurringTimer = setInterval(
      () => {
        embedRetryAllPending().catch((err) => {
          console.error("[embed-retry-sweep] unhandled error in recurring sweep", err);
        });
      },
      10 * 60 * 1000, // 10 minutes
    );

    // Don't prevent process exit
    recurringTimer.unref();
  }, 60 * 1000); // 60 seconds initial

  initialTimer.unref();
}

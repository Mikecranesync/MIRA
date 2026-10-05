/**
 * Failed embeds are retried, and the embedder's health is visible
 * (2026-10-05 embedding outage).
 *
 * `embedPendingNodeChunks` runs ONCE per upload, fire-and-forget. When the
 * embedder is unreachable those chunks stay BM25-only for good: nothing ever
 * looked at them again. From the move to the OVH host (2026-09-19) until the
 * embedder was colocated, that was every upload.
 *
 * The sweep finds each (tenant, upload) that still has `node_attachment` chunks
 * without a vector and re-runs that SAME per-upload pass, under the owning
 * tenant's context. It stops at the first upload the embedder cannot serve, so a
 * dead embedder costs one probe per sweep, not one per chunk.
 *
 * `embedderStatus()` is the cached probe the health endpoint reports, so the
 * embedding-coverage canary can tell "the embedder is down" from "nobody
 * uploaded anything today" — which looked identical before.
 */
import pool from "@/lib/db";
import {
  embedPendingNodeChunks,
  probeEmbedder,
  type EmbedFailureCode,
  type EmbedPassResult,
} from "@/lib/node-knowledge-ingest";

export interface PendingTarget {
  tenantId: string;
  sourceUrl: string;
}

interface Queryable {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Which uploads still have chunks without a vector — tenant id and source URL
 * only, never content, never returned to a user.
 *
 * Runs on the raw owner pool on purpose: the knowledge_entries RLS policy scopes
 * a connection to ONE tenant, and a retry sweep has to find every tenant's
 * pending uploads. Each upload is then embedded by `embedPendingNodeChunks`
 * under its own tenant context, exactly as at upload time.
 */
export async function listPendingEmbedTargets(limit: number, db: Queryable = pool as unknown as Queryable): Promise<PendingTarget[]> {
  const r = await db.query(
    `SELECT tenant_id::text AS tenant_id, source_url
       FROM knowledge_entries
      WHERE source_type = 'node_attachment' AND embedding IS NULL AND source_url IS NOT NULL
      GROUP BY tenant_id, source_url
      ORDER BY min(created_at)
      LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({ tenantId: String(row.tenant_id), sourceUrl: String(row.source_url) }));
}

export interface SweepResult {
  targets: number;
  embedded: number;
  /** Why the sweep stopped before the end of its list, or null. */
  stoppedOn: EmbedFailureCode | "disabled" | "list_failed" | null;
}

interface SweepDeps {
  list: (limit: number) => Promise<PendingTarget[]>;
  embed: (tenantId: string, sourceUrl: string) => Promise<EmbedPassResult>;
}

const DEFAULT_DEPS: SweepDeps = {
  list: (limit) => listPendingEmbedTargets(limit),
  embed: embedPendingNodeChunks,
};

let inFlight: Promise<SweepResult> | null = null;

/** One bounded sweep. Single-flight: a call while one runs joins it. Never throws. */
export function sweepPendingEmbeds(opts: { maxTargets: number }, deps: SweepDeps = DEFAULT_DEPS): Promise<SweepResult> {
  if (inFlight) return inFlight;
  inFlight = runSweep(opts.maxTargets, deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSweep(maxTargets: number, deps: SweepDeps): Promise<SweepResult> {
  let targets: PendingTarget[];
  try {
    targets = await deps.list(maxTargets);
  } catch (err) {
    console.error("[embed-retry-sweep] listing failed:", err instanceof Error ? err.message : err);
    return { targets: 0, embedded: 0, stoppedOn: "list_failed" };
  }
  let embedded = 0;
  for (const t of targets) {
    const r = await deps.embed(t.tenantId, t.sourceUrl);
    embedded += r.embedded;
    if (r.state === "disabled") return { targets: targets.length, embedded, stoppedOn: "disabled" };
    // Nothing written for this upload: the embedder (or the DB) cannot serve it
    // now, and it will not serve the next one either. Try again next sweep.
    if (r.state === "degraded" && r.embedded === 0) {
      return { targets: targets.length, embedded, stoppedOn: r.code ?? "embedder_unavailable" };
    }
  }
  return { targets: targets.length, embedded, stoppedOn: null };
}

/** Start the periodic sweep; returns a stop function. The timer never holds the process open. */
export function startEmbedRetrySweep(
  opts: { firstDelayMs: number; intervalMs: number; maxTargets: number },
  run: (o: { maxTargets: number }) => Promise<SweepResult> = sweepPendingEmbeds,
): () => void {
  const tick = async () => {
    const r = await run({ maxTargets: opts.maxTargets });
    if (r.targets > 0 || r.stoppedOn) {
      console.log(JSON.stringify({ service: "mira-hub", component: "embed-retry-sweep", event: "sweep", ...r }));
    }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), opts.intervalMs);
    if (typeof interval.unref === "function") interval.unref();
  }, opts.firstDelayMs);
  if (typeof first.unref === "function") first.unref();
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}

let started = false;

/**
 * Start the sweep once per process: a minute after the first call, then every
 * 10 minutes. Called from /api/health, which Docker's healthcheck polls from
 * boot. Off with NODE_EMBED_RETRY_SWEEP=0 (and inert while NODE_EMBED_ON_WRITE=0,
 * since every pass then returns "disabled").
 */
export function ensureEmbedRetrySweep(
  start: typeof startEmbedRetrySweep = startEmbedRetrySweep,
): boolean {
  if (started || process.env.NODE_EMBED_RETRY_SWEEP === "0") return false;
  started = true;
  const stop = start({ firstDelayMs: 60_000, intervalMs: 600_000, maxTargets: 25 });
  process.once("SIGTERM", stop);
  return true;
}

export function __resetSweepStartForTests(): void {
  started = false;
}

// ── Embedder health (reported by /api/health/embedder) ──────────────────────

export type EmbedderStatus =
  | "unknown"
  | "ok"
  | "not_configured"
  | "unreachable"
  | "http_error"
  | "timeout"
  | "dimension_mismatch";

const STATUS_BY_CODE: Partial<Record<EmbedFailureCode, EmbedderStatus>> = {
  embedder_not_configured: "not_configured",
  embedder_unavailable: "unreachable",
  embedder_http_error: "http_error",
  embedder_timeout: "timeout",
  embedding_dimension_mismatch: "dimension_mismatch",
};

const PROBE_INTERVAL_MS = 60_000;
let cached: { status: EmbedderStatus; checkedAt: number | null } = { status: "unknown", checkedAt: null };
let probing = false;

type Probe = () => Promise<{ vec: number[] } | { code: EmbedFailureCode }>;

/**
 * The last probe's verdict, synchronously (health must stay fast), refreshing in
 * the background at most once a minute. Never the URL or host.
 */
export function embedderStatus(
  deps: { probe?: Probe; now?: () => number } = {},
): { status: EmbedderStatus; model: string; checkedAt: number | null } {
  const probe = deps.probe ?? probeEmbedder;
  const now = (deps.now ?? Date.now)();
  if (!probing && (cached.checkedAt === null || now - cached.checkedAt >= PROBE_INTERVAL_MS)) {
    probing = true;
    void probe()
      .then((r) => {
        cached = { status: "vec" in r ? "ok" : (STATUS_BY_CODE[r.code] ?? "unreachable"), checkedAt: now };
      })
      .catch(() => {
        cached = { status: "unreachable", checkedAt: now };
      })
      .finally(() => {
        probing = false;
      });
  }
  return { status: cached.status, model: "nomic-embed-text", checkedAt: cached.checkedAt };
}

export function __resetEmbedderStatusForTests(): void {
  cached = { status: "unknown", checkedAt: null };
  probing = false;
}

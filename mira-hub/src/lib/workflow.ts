/**
 * runWorkflow / WorkflowRun — the Hub-side durable-workflow run tracker.
 *
 * The TypeScript twin of `mira-bots/shared/workflow.py`, writing the same
 * `workflow_runs` rows (migration 044). Use it to turn a fire-and-forget Hub
 * pipeline (ingest, KG build, CMMS sync) into a durable, observable run:
 *
 *   await runWorkflow(
 *     { workflowName: "pdf_ingest", tenantId, input: { file } },
 *     async (run) => {
 *       const text   = await run.step("parse",  () => parsePdf(file));
 *       const chunks = await run.step("chunk",  () => chunkText(text));
 *       await run.step("store", () => storeChunks(chunks));
 *       run.setOutput({ chunks: chunks.length });
 *     },
 *   );
 *   // clean return -> status "ok" (or "degraded" if a tolerated step failed)
 *   // throw        -> status "failed", error_detail captured, then re-thrown
 *
 * Contract (mirrors the Python wrapper):
 * - **Fail-open. ALWAYS.** A run-record write failure (NeonDB down, env unset,
 *   schema drift) must never break the wrapped work — including row creation. A
 *   failed create degrades to "not recorded"; the body still runs.
 * - **Steps buffered in memory, flushed ONCE at the end** — never a DB round-trip
 *   per step (Phase 2 wraps hot paths).
 * - **Pure state logic** (`computeFinalStatus` / `buildStepRecord`) is unit-tested
 *   without a DB; DB access goes through an injectable `WorkflowStore`.
 *
 * What `idempotencyKey` buys (and what it does NOT): a non-NULL key dedups the
 * `workflow_runs` row (ON CONFLICT DO NOTHING); a re-run reuses the row, bumps
 * retry_count, and sets `run.alreadySucceeded`. It does NOT auto-skip the body,
 * and it does NOT make a surface's own data-table writes idempotent — that is
 * fixed at each surface's INSERT.
 */

// The pg pool is imported lazily inside the default store (below) so this module
// can be imported for its pure helpers without instantiating a DB connection —
// the framework-free unit tests rely on this.

export type WorkflowStatus = "running" | "ok" | "degraded" | "failed";

const MAX_JSON_BYTES = 16_000;

export interface StepRecord {
  step_name: string;
  status: "ok" | "failed" | string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  artifact?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a DB)
// ---------------------------------------------------------------------------

/** Final run status from the exit condition. Pure. */
export function computeFinalStatus(threw: boolean, degraded: boolean): WorkflowStatus {
  if (threw) return "failed";
  return degraded ? "degraded" : "ok";
}

/** JSON-encode a value, bounding its size. `undefined`/`null` → null. */
export function boundedJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    encoded = JSON.stringify({ _unserializable: String(value).slice(0, MAX_JSON_BYTES) });
  }
  if (encoded === undefined) return null; // JSON.stringify(fn) etc.
  if (encoded.length > MAX_JSON_BYTES) {
    return JSON.stringify({ _truncated: true, preview: encoded.slice(0, MAX_JSON_BYTES) });
  }
  return encoded;
}

/** Assemble one step_artifacts entry. Pure. */
export function buildStepRecord(args: {
  stepName: string;
  status: string;
  startedAt: Date;
  finishedAt: Date;
  artifact?: unknown;
  error?: string;
}): StepRecord {
  const rec: StepRecord = {
    step_name: args.stepName,
    status: args.status,
    started_at: args.startedAt.toISOString(),
    finished_at: args.finishedAt.toISOString(),
    duration_ms: Math.max(0, args.finishedAt.getTime() - args.startedAt.getTime()),
  };
  if (args.artifact !== undefined && args.artifact !== null) {
    const bounded = boundedJson(args.artifact);
    rec.artifact = bounded === null ? null : JSON.parse(bounded);
  }
  if (args.error !== undefined) rec.error = args.error.slice(0, 2000);
  return rec;
}

// ---------------------------------------------------------------------------
// Store abstraction (injectable so the lifecycle is testable without pg)
// ---------------------------------------------------------------------------

export interface CreateRowInput {
  runId: string;
  workflowName: string;
  workflowVersion: string;
  tenantId: string | null;
  input: string | null; // bounded JSON string or null
  idempotencyKey: string | null;
  retryCount: number;
}

export interface CreateRowResult {
  runId: string;
  alreadySucceeded: boolean;
  retryCount: number;
}

export interface FinalizeInput {
  runId: string;
  status: WorkflowStatus;
  output: string | null;
  errorDetail: string | null;
  stepArtifacts: string; // JSON array string
}

export interface WorkflowStore {
  create(row: CreateRowInput): Promise<CreateRowResult | null>;
  finalize(input: FinalizeInput): Promise<void>;
}

async function getPool() {
  return (await import("./db")).default;
}

/** Default store — writes to NeonDB via the shared pg pool. */
export const pgWorkflowStore: WorkflowStore = {
  async create(row) {
    const pool = await getPool();
    const inserted = await pool.query(
      `INSERT INTO workflow_runs
         (run_id, workflow_name, workflow_version, tenant_id,
          status, input, idempotency_key, retry_count)
       VALUES ($1, $2, $3, $4, 'running', $5::jsonb, $6, $7)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
       RETURNING run_id`,
      [
        row.runId,
        row.workflowName,
        row.workflowVersion,
        row.tenantId,
        row.input,
        row.idempotencyKey,
        row.retryCount,
      ],
    );
    if (inserted.rows.length > 0) {
      return { runId: inserted.rows[0].run_id as string, alreadySucceeded: false, retryCount: row.retryCount };
    }

    // Conflict: reuse the existing row, surface its prior outcome, bump retry.
    const existing = await pool.query(
      `SELECT run_id, status FROM workflow_runs WHERE idempotency_key = $1`,
      [row.idempotencyKey],
    );
    if (existing.rows.length === 0) return null; // raced away → degrade to in-memory
    const runId = existing.rows[0].run_id as string;
    const alreadySucceeded = existing.rows[0].status === "ok";
    const updated = await pool.query(
      `UPDATE workflow_runs
          SET retry_count = retry_count + 1,
              status = 'running',
              started_at = NOW(),
              finished_at = NULL
        WHERE run_id = $1
       RETURNING retry_count`,
      [runId],
    );
    return {
      runId,
      alreadySucceeded,
      retryCount: updated.rows.length > 0 ? Number(updated.rows[0].retry_count) : row.retryCount,
    };
  },

  async finalize(input) {
    const pool = await getPool();
    await pool.query(
      `UPDATE workflow_runs
          SET status = $2,
              output = $3::jsonb,
              error_detail = $4,
              step_artifacts = $5::jsonb,
              finished_at = NOW()
        WHERE run_id = $1`,
      [input.runId, input.status, input.output, input.errorDetail, input.stepArtifacts],
    );
  },
};

// ---------------------------------------------------------------------------
// WorkflowRun
// ---------------------------------------------------------------------------

export interface WorkflowRunOptions {
  workflowName: string;
  version?: string;
  tenantId?: string | null;
  input?: unknown;
  idempotencyKey?: string | null;
  retryCount?: number;
  store?: WorkflowStore;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/** A JSON-able artifact summary — deliberately not `unknown` so the callback
 *  form keeps its parameter type (a union containing `unknown` collapses). */
export type ArtifactValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: unknown }
  | unknown[];

export interface StepOptions<R> {
  tolerate?: boolean;
  artifact?: ArtifactValue | ((result: R) => ArtifactValue);
}

function randomUuid(): string {
  // crypto.randomUUID is available in Node 18+ and Bun.
  return globalThis.crypto?.randomUUID?.() ?? `wfr-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export class WorkflowRun {
  readonly workflowName: string;
  readonly version: string;
  readonly tenantId: string | null;
  runId: string;
  status: WorkflowStatus = "running";
  output: unknown = null;
  errorDetail: string | null = null;
  alreadySucceeded = false;
  retryCount: number;

  private readonly input: unknown;
  private readonly idempotencyKey: string | null;
  private readonly store: WorkflowStore;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private readonly steps: StepRecord[] = [];
  private degraded = false;
  private recorded = false;

  constructor(opts: WorkflowRunOptions) {
    this.workflowName = opts.workflowName;
    this.version = opts.version ?? "1.0.0";
    this.tenantId = opts.tenantId ?? null;
    this.input = opts.input ?? null;
    this.idempotencyKey = opts.idempotencyKey ?? null;
    this.retryCount = opts.retryCount ?? 0;
    this.store = opts.store ?? pgWorkflowStore;
    this.log = opts.logger ?? console;
    this.runId = randomUuid();
  }

  setOutput(value: unknown): void {
    this.output = value;
  }

  /** Run `fn` as a recorded step; return its result. See module docstring.
   *  Not tolerated → resolves to `R` (and re-throws on failure); `tolerate:true`
   *  → resolves to `R | null` (null when the step failed and was swallowed). */
  step<R>(name: string, fn: () => Promise<R> | R, opts?: Omit<StepOptions<R>, "tolerate"> & { tolerate?: false }): Promise<R>;
  step<R>(name: string, fn: () => Promise<R> | R, opts: Omit<StepOptions<R>, "tolerate"> & { tolerate: true }): Promise<R | null>;
  async step<R>(name: string, fn: () => Promise<R> | R, opts: StepOptions<R> = {}): Promise<R | null> {
    const started = new Date();
    try {
      const result = await fn();
      const artifact =
        typeof opts.artifact === "function"
          ? (opts.artifact as (r: R) => ArtifactValue)(result)
          : opts.artifact;
      this.steps.push(
        buildStepRecord({ stepName: name, status: "ok", startedAt: started, finishedAt: new Date(), artifact }),
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.steps.push(
        buildStepRecord({ stepName: name, status: "failed", startedAt: started, finishedAt: new Date(), error: message }),
      );
      this.log.warn(`workflow ${this.workflowName} step ${name} failed: ${message}`);
      if (opts.tolerate) {
        this.degraded = true;
        return null;
      }
      throw err;
    }
  }

  /** Record a step that doesn't fit the `step(fn)` call-wrap shape. */
  recordStep(
    name: string,
    status: string,
    opts: { artifact?: unknown; error?: string; startedAt?: Date; finishedAt?: Date } = {},
  ): void {
    const now = new Date();
    if (status === "failed") this.degraded = true;
    this.steps.push(
      buildStepRecord({
        stepName: name,
        status,
        startedAt: opts.startedAt ?? now,
        finishedAt: opts.finishedAt ?? now,
        artifact: opts.artifact,
        error: opts.error,
      }),
    );
  }

  /** @internal — called by runWorkflow. */
  async _begin(): Promise<void> {
    try {
      const res = await this.store.create({
        runId: this.runId,
        workflowName: this.workflowName,
        workflowVersion: this.version,
        tenantId: this.tenantId,
        input: boundedJson(this.input),
        idempotencyKey: this.idempotencyKey,
        retryCount: this.retryCount,
      });
      if (res) {
        this.runId = res.runId;
        this.alreadySucceeded = res.alreadySucceeded;
        this.retryCount = res.retryCount;
        this.recorded = true;
      }
    } catch (err) {
      this.log.warn(`workflow run create skipped (degraded to in-memory): ${String(err)}`);
    }
    this.log.info(
      `workflow ${this.workflowName} v${this.version} started (run_id=${this.runId} tenant=${this.tenantId})`,
    );
  }

  /** @internal — called by runWorkflow. */
  async _finish(threw: boolean, error?: unknown): Promise<void> {
    this.status = computeFinalStatus(threw, this.degraded);
    if (threw && this.errorDetail === null) {
      this.errorDetail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    if (this.recorded) {
      try {
        await this.store.finalize({
          runId: this.runId,
          status: this.status,
          output: boundedJson(this.output),
          errorDetail: this.errorDetail,
          stepArtifacts: JSON.stringify(this.steps),
        });
      } catch (err) {
        this.log.warn(`workflow run finalize skipped: ${String(err)}`);
      }
    }
    const line = `workflow ${this.workflowName} finished status=${this.status} (run_id=${this.runId} steps=${this.steps.length})`;
    if (this.status === "failed") this.log.error(line);
    else this.log.info(line);
  }

  /** Test-only accessor for the buffered step records. */
  get _steps(): readonly StepRecord[] {
    return this.steps;
  }
}

/**
 * Run `fn` inside a durable workflow envelope. Creates the run record, runs the
 * body, finalizes status (ok/degraded/failed), and re-throws any error after
 * recording it. Returns whatever `fn` returns.
 */
export async function runWorkflow<T>(
  opts: WorkflowRunOptions,
  fn: (run: WorkflowRun) => Promise<T>,
): Promise<T> {
  const run = new WorkflowRun(opts);
  await run._begin();
  try {
    const result = await fn(run);
    await run._finish(false);
    return result;
  } catch (err) {
    await run._finish(true, err);
    throw err;
  }
}

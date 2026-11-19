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
 *
 * Opt-in `observation` runs use workflow-contract.ts: reference-only JSON,
 * bounded metadata latency, ordered live checkpoints and one row per attempt.
 * Rich states remain in JSON; domain stores still own execution and recovery.
 * Legacy callers retain the buffered behavior described above.
 */

import { parseWorkflowObservation, workflowRunStatus, type WorkflowObservation } from "./workflow-contract";
import type { PoolClient } from "pg";

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
  /** Optional for backwards-compatible stores. Progress never owns domain execution. */
  checkpoint?(input: FinalizeInput & { tenantId: string; workflowName: string }): Promise<void>;
}

async function getPool() {
  return (await import("./db")).default;
}

type WorkflowQuery = (sql: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** One SQL implementation; the observation path adds resource bounds only. */
function createPgWorkflowStore(query: WorkflowQuery): WorkflowStore {
  return {
  async create(row) {
    const inserted = await query(
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
    const existing = await query(
      `SELECT run_id, status FROM workflow_runs WHERE idempotency_key = $1`,
      [row.idempotencyKey],
    );
    if (existing.rows.length === 0) return null; // raced away → degrade to in-memory
    const runId = existing.rows[0].run_id as string;
    const alreadySucceeded = existing.rows[0].status === "ok";
    const updated = await query(
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
    await query(
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

  async checkpoint(input) {
    await query(
      `UPDATE workflow_runs SET output = $2::jsonb, step_artifacts = $3::jsonb
        WHERE run_id = $1 AND tenant_id = $4 AND workflow_name = $5
          AND status = 'running' AND finished_at IS NULL`,
      [input.runId, input.output, input.stepArtifacts, input.tenantId, input.workflowName],
    );
  },
  };
}

/** Legacy callers keep the existing shared-pool policy. */
export const pgWorkflowStore = createPgWorkflowStore(async (sql, values) => (await getPool()).query(sql, values));

// Observations may occupy at most one shared connection per process. They do
// not queue behind domain borrowers, and all timeout settings are local to the
// observation transaction. No new pool or execution/retry authority is added.
let observationQueryActive = false;
export async function queryWorkflowObservation(sql: string, values: unknown[], tenantId?: string) {
  if (observationQueryActive) throw new Error("workflow_observation_busy");
  observationQueryActive = true;
  let client: PoolClient | undefined;
  let expired = false;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const actual = (async () => {
    try {
      const pool = await getPool();
      if (expired || pool.waitingCount > 0 ||
        (pool.idleCount === 0 && pool.totalCount >= (pool.options.max ?? 5) - 1)) {
        throw new Error("workflow_observation_busy");
      }
      client = await pool.connect();
      if (expired) throw new Error("workflow_observation_timeout");
      await client.query("BEGIN; SET LOCAL lock_timeout = '100ms'; SET LOCAL statement_timeout = '500ms'" +
        (tenantId ? "; SET LOCAL ROLE factorylm_app" : ""));
      if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const result = await client.query(sql, values);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      // Discard an errored transaction/connection instead of queuing a rollback
      // behind a stuck query or leaking transaction-local settings to a user.
      if (client && !released) { released = true; client.release(true); }
      throw err;
    } finally {
      if (client && !released) { released = true; client.release(); }
    }
  })().finally(() => {
    clearTimeout(timer);
    // If connect settles after the deadline, keep this gate until its client
    // has been discarded. Repeated timeouts cannot queue more acquisitions.
    observationQueryActive = false;
  });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      if (client && !released) { released = true; client.release(true); }
      reject(new Error("workflow_observation_timeout"));
    }, 750);
  });
  return Promise.race([actual, deadline]);
}
const pgWorkflowObservationStore = createPgWorkflowStore(queryWorkflowObservation);

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
  /** Opt-in reference-only contract; one observation attempt per domain request. */
  observation?: WorkflowObservation;
  /** Bound metadata latency only; never a timeout or retry policy for domain work. */
  observationTimeoutMs?: number;
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
  private observation: WorkflowObservation | null = null;
  private progress: Promise<void> = Promise.resolve();
  private readonly observationTimeoutMs: number;
  private terminal: FinalizeInput | null = null;

  constructor(opts: WorkflowRunOptions) {
    const observation = opts.observation ? parseWorkflowObservation(opts.observation) : null;
    if (observation && (opts.workflowName !== observation.definition.name ||
      (opts.tenantId !== undefined && opts.tenantId !== observation.identity.tenantId) ||
      (opts.version !== undefined && opts.version !== observation.definition.version) || opts.idempotencyKey)) {
      throw new Error("workflow_observation_identity_mismatch");
    }
    this.workflowName = opts.workflowName;
    this.version = observation?.definition.version ?? opts.version ?? "1.0.0";
    this.tenantId = observation?.identity.tenantId ?? opts.tenantId ?? null;
    this.input = observation ? { workflow: observation } : opts.input ?? null;
    this.idempotencyKey = opts.idempotencyKey ?? null;
    this.retryCount = opts.retryCount ?? 0;
    this.store = opts.store ?? (observation ? pgWorkflowObservationStore : pgWorkflowStore);
    this.log = opts.logger ?? console;
    this.runId = observation?.identity.attemptId ?? randomUuid();
    this.observationTimeoutMs = Math.min(2000, Math.max(1, opts.observationTimeoutMs ?? 1000));
    if (observation) this.setObservation(observation);
  }

  setOutput(value: unknown): void {
    if (this.observation) throw new Error("use_setObservation_for_contract_runs");
    this.output = value;
  }

  setObservation(value: WorkflowObservation): void {
    const next = parseWorkflowObservation(value);
    const scope = (o: WorkflowObservation) => [o.definition.name, o.definition.version,
      o.identity.tenantId, o.identity.operationId, o.identity.attemptId, o.owner.system, o.owner.id].join("|");
    if (this.observation && scope(next) !== scope(this.observation)) {
      throw new Error("workflow_observation_identity_mismatch");
    }
    this.observation = next;
    this.output = { workflow: next };
  }

  /** Ordered progress writes; a late checkpoint cannot overwrite finalization. */
  checkpoint(value: WorkflowObservation): Promise<void> {
    this.setObservation(value);
    const snapshot = this.observation!;
    const output = boundedJson({ workflow: snapshot });
    const steps = this.stepJson();
    this.progress = this.progress.then(async () => {
      if (!this.recorded || !this.store.checkpoint) return;
      try {
        await this.observeWrite(this.store.checkpoint({ runId: this.runId, tenantId: snapshot.identity.tenantId,
          workflowName: this.workflowName, status: "running", output, errorDetail: null, stepArtifacts: steps }));
      } catch { this.log.warn(`workflow observation checkpoint unavailable (run_id=${this.runId})`); }
    });
    return this.progress;
  }

  private stepJson(): string {
    if (!this.observation) return JSON.stringify(this.steps);
    return JSON.stringify(this.steps.map((s) => ({
      step_name: /^[a-z][a-z0-9_]{0,63}$/.test(s.step_name) ? s.step_name : "operation",
      status: s.status === "ok" ? "ok" : "failed", started_at: s.started_at,
      finished_at: s.finished_at, duration_ms: s.duration_ms,
      ...(s.error ? { error: "operation_failed" } : {}),
    })));
  }

  private async observeWrite<T>(work: Promise<T>): Promise<T> {
    if (!this.observation) return work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("workflow_observation_timeout")), this.observationTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  private async finalize(input: FinalizeInput): Promise<void> {
    try { await this.observeWrite(this.store.finalize(input)); }
    catch (err) { this.log.warn(this.observation ? `workflow observation finalize unavailable (run_id=${this.runId})` : `workflow run finalize skipped: ${String(err)}`); }
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
      const message = this.observation ? "operation_failed" : err instanceof Error ? err.message : String(err);
      this.steps.push(
        buildStepRecord({ stepName: name, status: "failed", startedAt: started, finishedAt: new Date(), error: message }),
      );
      const label = this.observation && !/^[a-z][a-z0-9_]{0,63}$/.test(name) ? "operation" : name;
      this.log.warn(`workflow ${this.workflowName} step ${label} failed: ${message}`);
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
      const creating = this.store.create({
        runId: this.runId,
        workflowName: this.workflowName,
        workflowVersion: this.version,
        tenantId: this.tenantId,
        input: boundedJson(this.input),
        idempotencyKey: this.idempotencyKey,
        retryCount: this.retryCount,
      });
      if (this.observation) {
        // A timed-out metadata INSERT may settle after domain work. Close that
        // late row from the cached terminal snapshot; never execute work again.
        void creating.then((late) => {
          if (late?.runId === this.runId) {
            this.recorded = true;
            if (this.terminal) void this.finalize(this.terminal);
          }
        }).catch(() => undefined);
      }
      const res = await this.observeWrite(creating);
      if (res) {
        this.runId = res.runId;
        this.alreadySucceeded = res.alreadySucceeded;
        this.retryCount = res.retryCount;
        this.recorded = true;
      }
    } catch (err) {
      this.log.warn(this.observation ? `workflow observation create unavailable (run_id=${this.runId})` : `workflow run create skipped (degraded to in-memory): ${String(err)}`);
    }
    this.log.info(
      `workflow ${this.workflowName} v${this.version} started (run_id=${this.runId} tenant=${this.tenantId})`,
    );
  }

  /** @internal — called by runWorkflow. */
  async _finish(threw: boolean, error?: unknown): Promise<void> {
    await this.progress;
    this.status = computeFinalStatus(threw, this.degraded);
    if (this.observation) {
      const completed = !threw && !this.degraded && this.observation.state === "running";
      this.setObservation({ ...this.observation,
        state: threw ? "failed" : this.degraded && ["running", "succeeded"].includes(this.observation.state) ? "partial" : this.observation.state === "running" ? "succeeded" : this.observation.state,
        failure: threw ? { code: "operation_failed", retryable: false } : this.degraded ? this.observation.failure ?? { code: "operation_failed", retryable: false } : this.observation.failure,
        ...(completed ? { retry: { eligible: false, afterMs: null }, recovery: { ...this.observation.recovery, action: "none" as const } } : {}),
        observedAt: new Date().toISOString(),
      });
      this.status = workflowRunStatus(this.observation.state);
      this.errorDetail = this.observation.failure?.code ?? null;
    }
    if (threw && this.errorDetail === null) {
      this.errorDetail = this.observation ? "operation_failed" : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    this.terminal = {
      runId: this.runId,
      status: this.status,
      output: boundedJson(this.output),
      errorDetail: this.errorDetail,
      stepArtifacts: this.stepJson(),
    };
    if (this.recorded) await this.finalize(this.terminal);
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

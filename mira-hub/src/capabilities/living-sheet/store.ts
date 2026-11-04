/**
 * Living Work Sheet — the event-log writer and readers.
 *
 * Schema: db/proposed/114_living_work_sheet.sql (append-only, RLS UUID
 * family). Same shape as capabilities/observations/store.ts: every write is
 * one `withTenantContext` transaction, idempotency keyed on
 * (tenant, notebook, client_event_id) with a request fingerprint, and the
 * current sheet is never stored — it's `reduceSheet` over the events this
 * module reads back (reduce.ts).
 *
 * `livingSheetStorageUnavailable` lives here (not a new gate.ts — the task
 * spec's file list does not include one for this capability) but follows
 * the exact pattern of capabilities/observations/gate.ts's
 * `observationsStorageUnavailable`: a missing table (42P01) is a 503, never
 * an uncaught 500.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { NextResponse } from "next/server";
import { withTenantContext } from "@/lib/tenant-context";
import { reduceSheet, type SheetView, type StoredEvent } from "./reduce";
import type { EventKind, JobSheetBody } from "./types";
import type { ValidatedAppendInput, ValidatedStartJobInput } from "./validate";

export type Actor = { userId: string | null; label: string | null };

/** The machine this job is on — the route's server-resolved, confirmed
 *  binding (capabilities/observations/gate.ts::confirmedAssetOf), never a
 *  client-supplied value. */
export type JobMachine = { entityId: string; name: string };

/** A missing `work_sheet_events` table (migration 114 not yet applied) is a
 *  503, never an uncaught 500 — same contract as
 *  capabilities/observations/gate.ts::observationsStorageUnavailable. */
export function livingSheetStorageUnavailable(err: unknown): NextResponse | null {
  if ((err as { code?: string } | null)?.code === "42P01") {
    return NextResponse.json({ error: "living_sheet_unavailable" }, { status: 503 });
  }
  return null;
}

const EVENT_COLS = `id::text AS id, notebook_id::text AS notebook_id, job_id::text AS job_id, seq, kind,
  payload, client_event_id::text AS client_event_id, request_fingerprint, work_order_id,
  actor_user_id, actor_label, occurred_at, recorded_at`;

type EventRow = {
  id: string;
  notebook_id: string;
  job_id: string;
  seq: number;
  kind: EventKind;
  payload: unknown;
  client_event_id: string;
  request_fingerprint: string;
  work_order_id: string | null;
  actor_user_id: string | null;
  actor_label: string | null;
  occurred_at: string;
  recorded_at: string;
};

function toStoredEvent(r: EventRow): StoredEvent {
  return {
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    seq: Number(r.seq),
    actorLabel: r.actor_label ?? null,
    actorUserId: r.actor_user_id ?? null,
    occurredAt: new Date(r.occurred_at).toISOString(),
    recordedAt: new Date(r.recorded_at).toISOString(),
    workOrderId: r.work_order_id ?? null,
  } as StoredEvent;
}

function fingerprintOf(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// ---------------------------------------------------------------------------
// startJob
// ---------------------------------------------------------------------------

export type StartJobResult =
  | { status: "created"; jobId: string; event: StoredEvent; seq: 1; view: SheetView }
  | { status: "existing"; jobId: string; view: SheetView }
  | { status: "request_id_conflict" }
  | { status: "template_revision_not_found" };

async function loadEventsForJob(c: PoolClient, tenantId: string, jobId: string): Promise<EventRow[]> {
  const res = await c.query<EventRow>(
    `SELECT ${EVENT_COLS} FROM work_sheet_events WHERE tenant_id = $1::uuid AND job_id = $2::uuid ORDER BY seq ASC`,
    [tenantId, jobId],
  );
  return res.rows;
}

export async function startJob(
  tenantId: string,
  notebookId: string,
  asset: JobMachine,
  input: ValidatedStartJobInput,
  actor: Actor,
): Promise<StartJobResult> {
  return withTenantContext(tenantId, async (c) => {
    // A client-sent template body is ignored once templateRevisionId is
    // given (TASK-S4): the server loads the body from job_sheet_revisions
    // for THIS tenant and snapshots that instead. The fingerprint is
    // therefore computed inside this transaction, over the loaded body —
    // not over whatever the client sent — so a replay with a different
    // client-sent (but ignored) template still fingerprints identically.
    let template = input.template;
    let templateStatus: "draft" | "reviewed" | undefined;
    if (input.templateRevisionId !== null) {
      const rev = await c.query<{ body: JobSheetBody; status: "draft" | "reviewed" }>(
        `SELECT body, status FROM job_sheet_revisions WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, input.templateRevisionId],
      );
      if (rev.rows.length === 0) return { status: "template_revision_not_found" };
      template = rev.rows[0]!.body;
      templateStatus = rev.rows[0]!.status;
    }

    const fingerprint = fingerprintOf([
      notebookId,
      asset.entityId,
      input.title,
      input.templateRevisionId,
      template,
      input.occurredAt,
    ]);

    const jobId = randomUUID();
    const payload: {
      title: string;
      machine: JobMachine;
      templateRevisionId: string | null;
      template: JobSheetBody;
      templateStatus?: "draft" | "reviewed";
    } = {
      title: input.title,
      machine: { entityId: asset.entityId, name: asset.name },
      templateRevisionId: input.templateRevisionId,
      template,
      ...(templateStatus !== undefined ? { templateStatus } : {}),
    };

    const inserted = await c.query<EventRow>(
      `INSERT INTO work_sheet_events
         (tenant_id, notebook_id, job_id, seq, kind, payload, client_event_id, request_fingerprint,
          work_order_id, actor_user_id, actor_label, occurred_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'job_started', $4::jsonb, $5::uuid, $6, NULL, $7, $8, $9::timestamptz)
       ON CONFLICT (tenant_id, notebook_id, client_event_id) DO NOTHING
       RETURNING ${EVENT_COLS}`,
      [tenantId, notebookId, jobId, JSON.stringify(payload), input.clientEventId, fingerprint, actor.userId, actor.label, input.occurredAt],
    );

    if (inserted.rows.length > 0) {
      const event = toStoredEvent(inserted.rows[0]!);
      return { status: "created", jobId, event, seq: 1, view: reduceSheet([event], jobId) };
    }

    // Lost the race on (tenant_id, notebook_id, client_event_id), or this is
    // a genuine retry. Either way: find the row that already claimed it.
    const prior = await c.query<EventRow>(
      `SELECT ${EVENT_COLS} FROM work_sheet_events
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND client_event_id = $3::uuid`,
      [tenantId, notebookId, input.clientEventId],
    );
    const priorRow = prior.rows[0];
    if (!priorRow || priorRow.request_fingerprint !== fingerprint) return { status: "request_id_conflict" };

    const priorEvents = (await loadEventsForJob(c, tenantId, priorRow.job_id)).map(toStoredEvent);
    return { status: "existing", jobId: priorRow.job_id, view: reduceSheet(priorEvents, priorRow.job_id) };
  });
}

// ---------------------------------------------------------------------------
// appendEvent
// ---------------------------------------------------------------------------

export type AppendEventResult =
  | { status: "created"; event: StoredEvent; seq: number; view: SheetView }
  | { status: "existing"; event: StoredEvent }
  | { status: "request_id_conflict" }
  | { status: "job_not_found" }
  | { status: "invalid_target"; error: string; field?: string }
  | { status: "invalid_base_seq" }
  | { status: "job_finished"; seq: number; view: SheetView }
  | { status: "conflict"; seq: number; view: SheetView };

/** Same shared key as a (stepId / readingId / noteId) target, or a kind-level
 *  key for the two singleton facts (handover, finished). `null` for the
 *  "always commutative" kinds (part_logged, photo_attached) — they never
 *  conflict with a stale baseSeq. */
function targetKeyOf(kind: EventKind, payload: Record<string, unknown>): string | null {
  switch (kind) {
    case "step_marked":
      return `step:${payload.stepId as string}`;
    case "reading_recorded":
    case "reading_corrected":
      return `reading:${payload.readingId as string}`;
    case "note_added":
    case "question_resolved":
      return `note:${payload.noteId as string}`;
    case "handover_written":
      return "handover";
    case "job_finished":
      return "job_finished";
    default:
      return null;
  }
}

/** Two "step N is done" marks agree, so they never clash; only a contrary mark is a conflict. */
function sameStepMark(input: ValidatedAppendInput, e: StoredEvent): boolean {
  if (input.kind !== "step_marked" || e.kind !== "step_marked") return false;
  return (input.payload as { done: boolean }).done === (e.payload as { done: boolean }).done;
}

function validateTarget(input: ValidatedAppendInput, view: SheetView): { ok: true } | { ok: false; error: string; field: string } {
  switch (input.kind) {
    case "reading_recorded": {
      // A new reading needs a new id; re-using one would silently rewrite history (correct it instead).
      const p = input.payload as { readingId: string };
      if (view.readings.some((r) => r.id === p.readingId)) {
        return { ok: false, error: "reading_exists", field: "payload.readingId" };
      }
      return { ok: true };
    }
    case "note_added": {
      const p = input.payload as { noteId: string };
      if (view.notes.some((n) => n.id === p.noteId) || view.questions.some((q) => q.id === p.noteId)) {
        return { ok: false, error: "note_exists", field: "payload.noteId" };
      }
      return { ok: true };
    }
    case "step_marked": {
      const p = input.payload as { stepId: string };
      if (!view.steps.some((s) => s.id === p.stepId)) {
        return { ok: false, error: "unknown_step", field: "payload.stepId" };
      }
      return { ok: true };
    }
    case "reading_corrected": {
      const p = input.payload as { readingId: string };
      if (!view.readings.some((r) => r.id === p.readingId)) {
        return { ok: false, error: "unknown_reading", field: "payload.readingId" };
      }
      return { ok: true };
    }
    case "question_resolved": {
      const p = input.payload as { noteId: string };
      if (!view.questions.some((q) => q.id === p.noteId)) {
        return { ok: false, error: "unknown_note", field: "payload.noteId" };
      }
      return { ok: true };
    }
    case "job_finished": {
      const p = input.payload as { openItemsAcknowledged: boolean };
      const hasOpenItems = view.openSteps > 0 || view.openQuestions > 0;
      if (hasOpenItems && p.openItemsAcknowledged !== true) {
        return { ok: false, error: "open_items_not_acknowledged", field: "payload.openItemsAcknowledged" };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

export async function appendEvent(
  tenantId: string,
  notebookId: string,
  jobId: string,
  input: ValidatedAppendInput,
  actor: Actor,
): Promise<AppendEventResult> {
  const fingerprint = fingerprintOf([notebookId, jobId, input.baseSeq, input.kind, input.payload, input.occurredAt, input.workOrderId]);
  return withTenantContext(tenantId, async (c) => {
    // (1) Serialize appends to this one job (same xact-scoped advisory-lock
    // pattern as capabilities/cmms-dispatch/enqueue.ts::lockAggregate, keyed
    // on tenant+job rather than tenant+notebook since two jobs on the same
    // notebook over time must not serialize against each other).
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:${jobId}`]);

    // (2) Replay check on client_event_id, scoped to this notebook (matches
    // the UNIQUE (tenant_id, notebook_id, client_event_id) constraint).
    const prior = await c.query<EventRow>(
      `SELECT ${EVENT_COLS} FROM work_sheet_events
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND client_event_id = $3::uuid`,
      [tenantId, notebookId, input.clientEventId],
    );
    if (prior.rows.length > 0) {
      const priorRow = prior.rows[0]!;
      return priorRow.request_fingerprint === fingerprint
        ? { status: "existing", event: toStoredEvent(priorRow) }
        : { status: "request_id_conflict" };
    }

    // (3) Load the job's events.
    const rows = await loadEventsForJob(c, tenantId, jobId);
    if (rows.length === 0) return { status: "job_not_found" };
    if (rows[0]!.notebook_id !== notebookId) return { status: "job_not_found" };
    const events = rows.map(toStoredEvent);
    const view = reduceSheet(events, jobId);

    // A finished job is closed: nothing more is recorded on it (start a new job instead).
    if (view.finished) return { status: "job_finished", seq: view.seq, view };

    // (4) Validate against the current view.
    const target = validateTarget(input, view);
    if (!target.ok) return { status: "invalid_target", error: target.error, field: target.field };

    // (5) Conflict rule.
    if (input.baseSeq > view.seq) return { status: "invalid_base_seq" };
    if (input.baseSeq < view.seq) {
      const newKey = targetKeyOf(input.kind, input.payload as Record<string, unknown>);
      if (newKey !== null) {
        const touched = events.some(
          (e) =>
            e.seq > input.baseSeq &&
            targetKeyOf(e.kind, e.payload as Record<string, unknown>) === newKey &&
            !sameStepMark(input, e),
        );
        if (touched) return { status: "conflict", seq: view.seq, view };
      }
    }

    // (6) Insert at seq = current + 1.
    const nextSeq = view.seq + 1;
    const insertRes = await c.query<EventRow>(
      `INSERT INTO work_sheet_events
         (tenant_id, notebook_id, job_id, seq, kind, payload, client_event_id, request_fingerprint,
          work_order_id, actor_user_id, actor_label, occurred_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7::uuid, $8, $9, $10, $11, $12::timestamptz)
       ON CONFLICT (tenant_id, job_id, seq) DO NOTHING
       RETURNING ${EVENT_COLS}`,
      [
        tenantId,
        notebookId,
        jobId,
        nextSeq,
        input.kind,
        JSON.stringify(input.payload),
        input.clientEventId,
        fingerprint,
        input.workOrderId,
        actor.userId,
        actor.label,
        input.occurredAt,
      ],
    );

    if (insertRes.rows.length === 0) {
      // Lost a race for `nextSeq` despite the advisory lock (should not
      // happen — defensive, not reachable in normal operation). Re-derive
      // rather than assert: the caller's stale baseSeq becomes a conflict.
      const freshRows = await loadEventsForJob(c, tenantId, jobId);
      const freshView = reduceSheet(freshRows.map(toStoredEvent), jobId);
      return { status: "conflict", seq: freshView.seq, view: freshView };
    }

    const newEvent = toStoredEvent(insertRes.rows[0]!);
    return { status: "created", event: newEvent, seq: newEvent.seq, view: reduceSheet([...events, newEvent], jobId) };
  });
}

// ---------------------------------------------------------------------------
// listJobs / loadJob
// ---------------------------------------------------------------------------

export type JobSummary = {
  jobId: string;
  title: string;
  startedAt: string;
  startedBy: string | null;
  finished: boolean;
  seq: number;
};

type JobSummaryRow = {
  job_id: string;
  payload: { title: string };
  occurred_at: string;
  actor_label: string | null;
  actor_user_id: string | null;
  seq: string;
  finished: boolean;
};

export async function listJobs(tenantId: string, notebookId: string): Promise<JobSummary[]> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<JobSummaryRow>(
      `SELECT e.job_id::text AS job_id, e.payload, e.occurred_at, e.actor_label, e.actor_user_id,
              (SELECT max(seq) FROM work_sheet_events s2 WHERE s2.tenant_id = e.tenant_id AND s2.job_id = e.job_id) AS seq,
              EXISTS (
                SELECT 1 FROM work_sheet_events s3
                 WHERE s3.tenant_id = e.tenant_id AND s3.job_id = e.job_id AND s3.kind = 'job_finished'
              ) AS finished
         FROM work_sheet_events e
        WHERE e.tenant_id = $1::uuid AND e.notebook_id = $2::uuid AND e.kind = 'job_started'
        ORDER BY e.occurred_at DESC
        LIMIT 200`,
      [tenantId, notebookId],
    );
    return res.rows.map((r) => ({
      jobId: r.job_id,
      title: r.payload.title,
      startedAt: new Date(r.occurred_at).toISOString(),
      startedBy: r.actor_label ?? r.actor_user_id ?? null,
      finished: r.finished === true,
      seq: Number(r.seq),
    }));
  });
}

// ---------------------------------------------------------------------------
// listJobsActiveBetween (S6 — shift report)
// ---------------------------------------------------------------------------

export type ActiveJob = {
  notebookId: string;
  notebookName: string;
  jobId: string;
  view: SheetView;
  events: StoredEvent[];
};

/** Read-only: every job on this tenant with at least one event whose
 *  `occurred_at` falls in [fromIso, toIso], across all of the tenant's
 *  notebooks. Each returned job carries its FULL event log (not just the
 *  in-window slice) so `shiftReport` (S6) can resolve step numbers and
 *  correction deltas that may predate the window. Notebook display name
 *  comes from `equipment_notebooks.display_name` (migration 073). */
export async function listJobsActiveBetween(tenantId: string, fromIso: string, toIso: string): Promise<ActiveJob[]> {
  return withTenantContext(tenantId, async (c) => {
    const touched = await c.query<{ job_id: string; notebook_id: string; notebook_name: string }>(
      `SELECT DISTINCT e.job_id::text AS job_id, e.notebook_id::text AS notebook_id, n.display_name AS notebook_name
         FROM work_sheet_events e
         JOIN equipment_notebooks n ON n.tenant_id = e.tenant_id AND n.id = e.notebook_id
        WHERE e.tenant_id = $1::uuid AND e.occurred_at >= $2::timestamptz AND e.occurred_at <= $3::timestamptz`,
      [tenantId, fromIso, toIso],
    );
    if (touched.rows.length === 0) return [];

    const jobIds = touched.rows.map((r) => r.job_id);
    const allRows = await c.query<EventRow>(
      `SELECT ${EVENT_COLS} FROM work_sheet_events
        WHERE tenant_id = $1::uuid AND job_id = ANY($2::uuid[])
        ORDER BY job_id, seq ASC`,
      [tenantId, jobIds],
    );
    const byJob = new Map<string, EventRow[]>();
    for (const row of allRows.rows) {
      const arr = byJob.get(row.job_id) ?? [];
      arr.push(row);
      byJob.set(row.job_id, arr);
    }

    return touched.rows.map((t) => {
      const rows = byJob.get(t.job_id) ?? [];
      const events = rows.map(toStoredEvent);
      return {
        notebookId: t.notebook_id,
        notebookName: t.notebook_name,
        jobId: t.job_id,
        view: reduceSheet(events, t.job_id),
        events,
      };
    });
  });
}

export type LoadJobResult = { status: "ok"; view: SheetView } | { status: "job_not_found" };

export async function loadJob(tenantId: string, notebookId: string, jobId: string, atSeq?: number): Promise<LoadJobResult> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<EventRow>(
      `SELECT ${EVENT_COLS} FROM work_sheet_events
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND job_id = $3::uuid
        ORDER BY seq ASC`,
      [tenantId, notebookId, jobId],
    );
    if (res.rows.length === 0) return { status: "job_not_found" };
    const events = res.rows.map(toStoredEvent);
    const scoped = atSeq === undefined ? events : events.filter((e) => e.seq <= atSeq);
    if (scoped.length === 0) return { status: "job_not_found" };
    return { status: "ok", view: reduceSheet(scoped, jobId) };
  });
}

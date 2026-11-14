/**
 * Bench components — the store (schema: db/proposed/115_bench_components.sql).
 *
 * Every read and write runs in one withTenantContext transaction (RLS, UUID
 * family). Ownership is checked IN each statement: a component of another
 * notebook or tenant yields zero rows, never a write. Every write is keyed on
 * a client-minted request id, so a retried tap returns what the first one
 * did and never adds a second row; a reused id carrying different content is
 * a conflict, never someone else's success.
 *
 * Revisions are append-only. A save whose identity is the same as the
 * current revision's writes nothing ("unchanged"): a confirmed component is
 * not asked to be confirmed again until something material changes.
 */
import type { PoolClient } from "pg";
import { withTenantContext } from "@/lib/tenant-context";
import type { ComponentInputKind, ComponentIdentityStatus, ComponentRevision, SelectedComponent, SelectionTurn } from "./selection";
import { sameContent, type ComponentRevisionInput } from "./validate";

export type ComponentOrigin = "device_schedule" | "inventory" | "technician";
export type SelectedVia = "picker" | "return" | "clarify" | "confirm" | "correction";

export type ComponentRecord = {
  id: string;
  notebookId: string;
  position: number;
  kind: string | null;
  origin: ComponentOrigin;
  createdAt: string;
  retiredAt: string | null;
  /** The newest revision, or null when the row was added with no description yet. */
  current: StoredRevision | null;
};

export type ThreadSelection = SelectedComponent & { selectedVia: SelectedVia; version: number };

const COMPONENT_COLS = `c.id::text AS id, c.notebook_id::text AS notebook_id, c.position, c.kind, c.origin,
  c.created_at, c.retired_at`;
const REVISION_COLS = `r.component_id::text AS component_id, r.revision, r.raw_label, r.input_kind, r.manufacturer,
  r.family, r.catalog_number, r.serial_number, r.hardware_revision, r.local_tag, r.identity_status, r.unresolved,
  r.evidence_file_id::text AS evidence_file_id, r.evidence_note, r.confirmed_at, r.created_at AS revision_created_at,
  r.client_request_id::text AS revision_request_id`;

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const str = (v: unknown) => (v == null ? null : String(v));

export type StoredRevision = ComponentRevision & { evidenceFileId: string | null; evidenceNote: string | null };

function toRevision(r: Record<string, unknown>): StoredRevision {
  return {
    componentId: String(r.component_id),
    revision: Number(r.revision),
    rawLabel: str(r.raw_label),
    inputKind: String(r.input_kind) as ComponentInputKind,
    manufacturer: str(r.manufacturer),
    family: str(r.family),
    catalogNumber: str(r.catalog_number),
    serialNumber: str(r.serial_number),
    hardwareRevision: str(r.hardware_revision),
    localTag: str(r.local_tag),
    identityStatus: String(r.identity_status) as ComponentIdentityStatus,
    unresolved: Array.isArray(r.unresolved) ? (r.unresolved as unknown[]).map(String) : [],
    evidenceFileId: str(r.evidence_file_id),
    evidenceNote: str(r.evidence_note),
    confirmedAt: iso(r.confirmed_at),
    createdAt: iso(r.revision_created_at) ?? "",
  };
}

function toComponent(r: Record<string, unknown>): ComponentRecord {
  return {
    id: String(r.id),
    notebookId: String(r.notebook_id),
    position: Number(r.position),
    kind: str(r.kind),
    origin: String(r.origin) as ComponentOrigin,
    createdAt: iso(r.created_at) ?? "",
    retiredAt: iso(r.retired_at),
    current: r.revision == null ? null : toRevision(r),
  };
}

const LATEST_JOIN = `LEFT JOIN LATERAL (
    SELECT * FROM notebook_component_revisions r0
     WHERE r0.tenant_id = c.tenant_id AND r0.component_id = c.id
     ORDER BY r0.revision DESC LIMIT 1
  ) r ON TRUE`;

/** Every component of one notebook (retired ones included, flagged), checklist order. */
export async function listComponents(tenantId: string, notebookId: string): Promise<ComponentRecord[]> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT ${COMPONENT_COLS}, ${REVISION_COLS}
         FROM notebook_components c ${LATEST_JOIN}
        WHERE c.tenant_id = $1::uuid AND c.notebook_id = $2::uuid
        ORDER BY c.position, c.created_at, c.id`,
      [tenantId, notebookId],
    );
    return res.rows.map(toComponent);
  });
}

async function readComponent(c: PoolClient, tenantId: string, notebookId: string, componentId: string, lock = false) {
  const res = await c.query(
    `SELECT ${COMPONENT_COLS}, ${REVISION_COLS}
       FROM notebook_components c ${LATEST_JOIN}
      WHERE c.tenant_id = $1::uuid AND c.notebook_id = $2::uuid AND c.id = $3::uuid${lock ? " FOR UPDATE OF c" : ""}`,
    [tenantId, notebookId, componentId],
  );
  return res.rows[0] ? toComponent(res.rows[0]) : null;
}

export async function getComponent(tenantId: string, notebookId: string, componentId: string): Promise<ComponentRecord | null> {
  return withTenantContext(tenantId, (c) => readComponent(c, tenantId, notebookId, componentId));
}

async function insertRevision(
  c: PoolClient,
  tenantId: string,
  componentId: string,
  revision: number,
  input: ComponentRevisionInput,
  userId: string,
  clientRequestId: string,
): Promise<StoredRevision> {
  const confirmed = input.identityStatus === "user_confirmed";
  const res = await c.query(
    `INSERT INTO notebook_component_revisions AS r
       (tenant_id, component_id, revision, raw_label, input_kind, manufacturer, family, catalog_number,
        serial_number, hardware_revision, local_tag, identity_status, unresolved, evidence_file_id,
        evidence_note, confirmed_by, confirmed_at, created_by, client_request_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::uuid, $15,
             $16, ${confirmed ? "now()" : "NULL"}, $17, $18::uuid)
     RETURNING ${REVISION_COLS}`,
    [
      tenantId, componentId, revision, input.rawLabel, input.inputKind, input.manufacturer, input.family,
      input.catalogNumber, input.serialNumber, input.hardwareRevision, input.localTag, input.identityStatus,
      JSON.stringify(input.unresolved), input.evidenceFileId, input.evidenceNote,
      confirmed ? userId : null, userId, clientRequestId,
    ],
  );
  return toRevision(res.rows[0]);
}

export type AddComponentResult =
  | { status: "created" | "existing"; component: ComponentRecord }
  | { status: "notebook_not_found" }
  | { status: "request_id_conflict" };

/** Add one component to a notebook's checklist, optionally with its first revision. */
export async function addComponent(
  tenantId: string,
  notebookId: string,
  userId: string,
  input: { clientRequestId: string; kind: string | null; origin: ComponentOrigin; position: number | null; revision: ComponentRevisionInput | null },
): Promise<AddComponentResult> {
  return withTenantContext(tenantId, async (c) => {
    const prior = await c.query(
      `SELECT c.id::text AS id, c.notebook_id::text AS notebook_id FROM notebook_components c
        WHERE c.tenant_id = $1::uuid AND c.client_request_id = $2::uuid`,
      [tenantId, input.clientRequestId],
    );
    if (prior.rows[0]) {
      if (String(prior.rows[0].notebook_id) !== notebookId) return { status: "request_id_conflict" };
      const existing = await readComponent(c, tenantId, notebookId, String(prior.rows[0].id));
      if (!existing) return { status: "request_id_conflict" };
      // A retry is compared with what the add itself wrote, not the latest revision:
      // a component confirmed or corrected since is still the same add.
      const first = await c.query(
        `SELECT ${REVISION_COLS} FROM notebook_component_revisions r
          WHERE r.tenant_id = $1::uuid AND r.component_id = $2::uuid AND r.revision = 1`,
        [tenantId, existing.id],
      );
      const added = first.rows[0] && String(first.rows[0].revision_request_id) === input.clientRequestId ? toRevision(first.rows[0]) : null;
      const sameShape =
        existing.kind === input.kind &&
        existing.origin === input.origin &&
        (input.revision === null ? added === null : added !== null && sameContent(added, input.revision));
      return sameShape ? { status: "existing", component: existing } : { status: "request_id_conflict" };
    }
    const inserted = await c.query(
      `INSERT INTO notebook_components (tenant_id, notebook_id, position, kind, origin, created_by, client_request_id)
       SELECT n.tenant_id, n.id,
              COALESCE($3::int, (SELECT COALESCE(MAX(position), -1) + 1 FROM notebook_components x
                                  WHERE x.tenant_id = n.tenant_id AND x.notebook_id = n.id)),
              $4, $5, $6, $7::uuid
         FROM equipment_notebooks n
        WHERE n.id = $2::uuid AND n.tenant_id = $1::uuid
       RETURNING id::text AS id`,
      [tenantId, notebookId, input.position, input.kind, input.origin, userId, input.clientRequestId],
    );
    if (!inserted.rows[0]) return { status: "notebook_not_found" };
    const id = String(inserted.rows[0].id);
    if (input.revision) {
      // The first revision's request id is derived from the component's, so a retry of the
      // whole add stays one component with one revision.
      await insertRevision(c, tenantId, id, 1, input.revision, userId, input.clientRequestId);
    }
    const component = await readComponent(c, tenantId, notebookId, id);
    return { status: "created", component: component as ComponentRecord };
  });
}

export type ReviseComponentResult =
  | { status: "created" | "existing" | "unchanged"; component: ComponentRecord; previous: StoredRevision | null }
  | { status: "component_not_found" }
  | { status: "stale_revision"; component: ComponentRecord }
  | { status: "request_id_conflict" };

/**
 * Record a new identity revision (clarify, correct, confirm, mark not sure).
 * `expectedRevision` is the revision the technician was looking at (0 = none):
 * a save made against an older view is refused, so two devices never silently
 * overwrite each other's correction.
 */
export async function reviseComponent(
  tenantId: string,
  notebookId: string,
  componentId: string,
  userId: string,
  input: { clientRequestId: string; expectedRevision: number; revision: ComponentRevisionInput },
): Promise<ReviseComponentResult> {
  return withTenantContext(tenantId, async (c) => {
    const prior = await c.query(
      `SELECT r.component_id::text AS component_id, r.revision FROM notebook_component_revisions r
        WHERE r.tenant_id = $1::uuid AND r.client_request_id = $2::uuid`,
      [tenantId, input.clientRequestId],
    );
    const component = await readComponent(c, tenantId, notebookId, componentId, true);
    if (!component) return { status: "component_not_found" };
    if (prior.rows[0]) {
      if (String(prior.rows[0].component_id) !== componentId) return { status: "request_id_conflict" };
      const stored = await c.query(
        `SELECT ${REVISION_COLS} FROM notebook_component_revisions r
          WHERE r.tenant_id = $1::uuid AND r.component_id = $2::uuid AND r.revision = $3`,
        [tenantId, componentId, Number(prior.rows[0].revision)],
      );
      const rev = toRevision(stored.rows[0]);
      return sameContent(rev, input.revision) ? { status: "existing", component, previous: null } : { status: "request_id_conflict" };
    }
    const currentRevision = component.current?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) return { status: "stale_revision", component };
    if (component.current && sameContent(component.current, input.revision)) {
      return { status: "unchanged", component, previous: null };
    }
    await insertRevision(c, tenantId, componentId, currentRevision + 1, input.revision, userId, input.clientRequestId);
    const updated = await readComponent(c, tenantId, notebookId, componentId);
    return { status: "created", component: updated as ComponentRecord, previous: (component.current as StoredRevision | null) ?? null };
  });
}

function toSelection(r: Record<string, unknown>): ThreadSelection {
  return {
    componentId: String(r.component_id),
    revision: Number(r.component_revision),
    selectedAt: iso(r.selected_at) ?? "",
    selectedVia: String(r.selected_via) as SelectedVia,
    version: Number(r.version),
  };
}

/**
 * Timestamps that decide the carry boundary are read at the database's full
 * (microsecond) precision: a JS Date keeps milliseconds only, and a turn in the
 * same millisecond as a pick would tie with it (selection.ts compares exactly).
 */
const MICROS = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const SELECTION_COLS = `s.component_id::text AS component_id, s.component_revision, ${MICROS("s.selected_at")} AS selected_at, s.selected_via, s.version,
  s.last_request_id::text AS last_request_id, s.cleared_at IS NOT NULL AS cleared`;

export async function getSelection(tenantId: string, notebookId: string, ownerUserId: string, threadKey: string): Promise<ThreadSelection | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT ${SELECTION_COLS} FROM notebook_thread_selections s
        WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.owner_user_id = $3 AND s.thread_key = $4
          AND s.cleared_at IS NULL`,
      [tenantId, notebookId, ownerUserId, threadKey],
    );
    return res.rows[0] ? toSelection(res.rows[0]) : null;
  });
}

/**
 * The version a client must send with its next pick: the stored row's, cleared or not
 * (a cleared selection keeps counting), or null when this conversation never had one.
 */
export async function getSelectionVersion(tenantId: string, notebookId: string, ownerUserId: string, threadKey: string): Promise<number | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT s.version FROM notebook_thread_selections s
        WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.owner_user_id = $3 AND s.thread_key = $4`,
      [tenantId, notebookId, ownerUserId, threadKey],
    );
    return res.rows[0] ? Number(res.rows[0].version) : null;
  });
}

/**
 * Both halves of a conversation's saved choice in one read: the selected component (null
 * when none or cleared) and the row's version (null when it never had one). The chat route
 * checks every question's scope against this (#5504 post-cap F9/F10).
 */
export async function getSelectionState(
  tenantId: string,
  notebookId: string,
  ownerUserId: string,
  threadKey: string,
): Promise<{ selection: ThreadSelection | null; version: number | null }> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT ${SELECTION_COLS} FROM notebook_thread_selections s
        WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.owner_user_id = $3 AND s.thread_key = $4`,
      [tenantId, notebookId, ownerUserId, threadKey],
    );
    // Every chat turn runs this read; a driver result always has `rows`. Route tests whose
    // database stand-in answers only the queries they know get "no row" here, as before this read.
    const row = res?.rows?.[0];
    if (!row) return { selection: null, version: null };
    return { selection: row.cleared ? null : toSelection(row), version: Number(row.version) };
  });
}

export type SetSelectionResult =
  | { status: "set" | "existing"; selection: ThreadSelection }
  | { status: "cleared" }
  | { status: "component_not_found" }
  | { status: "component_retired" }
  | { status: "version_conflict"; selection: ThreadSelection | null };

/**
 * Point one technician's conversation at a component (or clear it: whole machine).
 * Every explicit pick moves selected_at, re-picking the same component included:
 * "Return to <component>" after a refusal is exactly that case, and it must end
 * the carry. `expectedVersion` (the stored version, cleared or not; null only when
 * this conversation never had a selection) makes two taps on two devices a conflict
 * instead of a silent overwrite. Clearing keeps the row, so the version never repeats. A retried request with
 * the same request id is a no-op that returns the stored row.
 */
export async function setSelection(
  tenantId: string,
  notebookId: string,
  ownerUserId: string,
  threadKey: string,
  input: { componentId: string | null; via: SelectedVia; expectedVersion: number | null; clientRequestId: string },
): Promise<SetSelectionResult> {
  return withTenantContext(tenantId, async (c) => {
    const currentRes = await c.query(
      `SELECT ${SELECTION_COLS} FROM notebook_thread_selections s
        WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.owner_user_id = $3 AND s.thread_key = $4
        FOR UPDATE`,
      [tenantId, notebookId, ownerUserId, threadKey],
    );
    const row = currentRes.rows[0];
    // A cleared row is no selection, but its version still counts.
    const current = row && !row.cleared ? toSelection(row) : null;
    if (row && row.last_request_id === input.clientRequestId) {
      if (row.cleared && input.componentId === null) return { status: "cleared" };
      if (current && current.componentId === input.componentId) return { status: "existing", selection: current };
    }
    if ((row ? Number(row.version) : null) !== input.expectedVersion) return { status: "version_conflict", selection: current };
    if (input.componentId === null) {
      if (row) {
        await c.query(
          `UPDATE notebook_thread_selections s
              SET cleared_at = clock_timestamp(), selected_via = $5, version = s.version + 1, last_request_id = $6::uuid
            WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.owner_user_id = $3 AND s.thread_key = $4`,
          [tenantId, notebookId, ownerUserId, threadKey, input.via, input.clientRequestId],
        );
      }
      return { status: "cleared" };
    }
    const component = await readComponent(c, tenantId, notebookId, input.componentId);
    if (!component) return { status: "component_not_found" };
    if (component.retiredAt) return { status: "component_retired" };
    if (!component.current) return { status: "component_not_found" };
    const res = await c.query(
      `INSERT INTO notebook_thread_selections AS s
         (tenant_id, notebook_id, owner_user_id, thread_key, component_id, component_revision, selected_via,
          selected_at, version, last_request_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, clock_timestamp(), 1, $8::uuid)
       ON CONFLICT (tenant_id, notebook_id, owner_user_id, thread_key) DO UPDATE
         SET component_id = EXCLUDED.component_id,
             component_revision = EXCLUDED.component_revision,
             selected_via = EXCLUDED.selected_via,
             selected_at = clock_timestamp(),
             version = s.version + 1,
             last_request_id = EXCLUDED.last_request_id,
             cleared_at = NULL
         -- FOR UPDATE above locks nothing when there was no row: a first pick made at the
         -- same moment on another screen inserts one. Overwrite only the version this caller saw.
         WHERE s.version IS NOT DISTINCT FROM $9::int
       RETURNING ${SELECTION_COLS}`,
      [tenantId, notebookId, ownerUserId, threadKey, input.componentId, component.current.revision, input.via, input.clientRequestId, input.expectedVersion],
    );
    if (!res.rows[0]) {
      const racedRes = await c.query(
        `SELECT ${SELECTION_COLS} FROM notebook_thread_selections s
          WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.owner_user_id = $3 AND s.thread_key = $4`,
        [tenantId, notebookId, ownerUserId, threadKey],
      );
      const raced = racedRes.rows[0] && !racedRes.rows[0].cleared ? toSelection(racedRes.rows[0]) : null;
      if (raced && racedRes.rows[0].last_request_id === input.clientRequestId && raced.componentId === input.componentId) {
        return { status: "existing", selection: raced };
      }
      return { status: "version_conflict", selection: raced };
    }
    return { status: "set", selection: toSelection(res.rows[0]) };
  });
}

/**
 * The selection was made under an older identity revision of its component
 * (the identity was corrected since). Re-point it at the current revision and
 * move the boundary, so nothing asked under the old identity carries.
 * `beforeRequestId` is the turn that found the correction: it was claimed before
 * this runs, so the boundary goes just before it and that question belongs to the
 * new selection (it is stamped with the new revision).
 */
export async function advanceSelectionRevision(
  tenantId: string,
  notebookId: string,
  ownerUserId: string,
  threadKey: string,
  expectedVersion: number,
  revision: number,
  beforeRequestId: string | null = null,
): Promise<ThreadSelection | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE notebook_thread_selections s
          SET component_revision = $6, selected_via = 'correction', version = s.version + 1,
              selected_at = COALESCE(
                (SELECT t.created_at - interval '1 microsecond' FROM equipment_notebook_turns t
                  WHERE t.tenant_id = $1::uuid AND t.notebook_id = $2::uuid AND t.client_request_id = $7::uuid),
                clock_timestamp())
        WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.owner_user_id = $3 AND s.thread_key = $4
          AND s.version = $5 AND s.cleared_at IS NULL
       RETURNING ${SELECTION_COLS}`,
      [tenantId, notebookId, ownerUserId, threadKey, expectedVersion, revision, beforeRequestId],
    );
    return res.rows[0] ? toSelection(res.rows[0]) : null;
  });
}

/** Stamp the claimed turn with the component (and identity revision) it is asked under. */
export async function stampTurnComponent(
  tenantId: string,
  notebookId: string,
  ownerUserId: string,
  clientRequestId: string,
  componentId: string,
  revision: number,
): Promise<boolean> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE equipment_notebook_turns t
          SET component_id = $5::uuid, component_revision = $6
        WHERE t.tenant_id = $1::uuid AND t.notebook_id = $2::uuid AND t.owner_user_id = $3
          AND t.client_request_id = $4::uuid
          AND EXISTS (SELECT 1 FROM notebook_components c
                       WHERE c.tenant_id = t.tenant_id AND c.notebook_id = t.notebook_id AND c.id = $5::uuid)`,
      [tenantId, notebookId, ownerUserId, clientRequestId, componentId, revision],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/**
 * The newest `limit` completed turns of one technician's conversation, OLDEST
 * FIRST, with the component each was asked under — the read the selection
 * carry and the selection history need (selection.ts readSubjectUnderSelection,
 * historyUnderSelection). Same visibility as
 * listTurns: the viewer's own turns plus ownerless legacy rows.
 */
export async function listSelectionTurns(
  tenantId: string,
  notebookId: string,
  viewerUserId: string,
  threadId: string | null,
  limit: number,
  /** The chat route's history needs each answer and its evidence; the panel's read does not. */
  opts: { withAnswers?: boolean } = {},
): Promise<(SelectionTurn & { id: string; clientRequestId: string | null; answerText: string | null; evidence: unknown[] })[]> {
  return withTenantContext(tenantId, async (c) => {
    const values: unknown[] = [tenantId, notebookId, limit, viewerUserId];
    const threadPredicate = threadId === null ? "AND thread_id IS NULL" : `AND thread_id = $${values.push(threadId)}`;
    const answers = opts.withAnswers ? "answer_text, evidence" : "NULL::text AS answer_text, NULL::jsonb AS evidence";
    const res = await c.query(
      `SELECT id, question, answer_status, answer_text, evidence, basis, ${MICROS("created_at")} AS created_at_us, component_id, component_revision, client_request_id FROM (
         SELECT id::text AS id, question, answer_status, ${answers}, basis, created_at, component_id::text AS component_id,
                component_revision, client_request_id::text AS client_request_id
           FROM equipment_notebook_turns
          WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND client_request_state = 'complete'
            AND (owner_user_id = $4 OR owner_user_id IS NULL) ${threadPredicate}
          ORDER BY created_at DESC LIMIT $3
       ) recent ORDER BY created_at ASC`,
      values,
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      question: str(r.question),
      answerStatus: str(r.answer_status),
      answerText: str(r.answer_text),
      evidence: Array.isArray(r.evidence) ? r.evidence : [],
      basis: str(r.basis),
      createdAt: str(r.created_at_us) ?? "",
      componentId: str(r.component_id),
      componentRevision: r.component_revision == null ? null : Number(r.component_revision),
      clientRequestId: str(r.client_request_id),
    }));
  });
}


/**
 * Each document's opening text — the same "cover" the answer path reads
 * (manual-rag.ts documentHeadingSql): the first v2 chunk by page, then chunk order.
 * Tenant-scoped; a document whose text this tenant cannot read has no heading,
 * which the view shows as "not stated", never as a match.
 */
export async function readDocumentHeadings(tenantId: string, docIds: readonly string[]): Promise<Map<string, string>> {
  if (docIds.length === 0) return new Map();
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT DISTINCT ON (doc_id) doc_id::text AS doc_id, left(content, 2000) AS heading
         FROM knowledge_entries
        WHERE tenant_id = $1::uuid AND doc_id::text = ANY($2::text[]) AND ingest_route = 'v2'
        ORDER BY doc_id, page_start NULLS LAST, source_page NULLS LAST,
                 (metadata->>'chunk_index')::int NULLS LAST, id`,
      [tenantId, [...docIds]],
    );
    return new Map(res.rows.map((r: Record<string, unknown>) => [String(r.doc_id), String(r.heading ?? "")]));
  });
}

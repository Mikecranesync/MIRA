-- Migration 114 (PROPOSED — not in db/migrations/ on purpose): the Living
-- Work Sheet event log (TASK-S1-events-store-api.md).
--
-- WHY: one job on one confirmed machine, every change an append-only event,
-- the current sheet = a pure reduce over those events
-- (src/capabilities/living-sheet/reduce.ts). A correction supersedes and
-- never deletes. Ticks never carry over from a template: a job sheet's
-- steps carry no "done" flag — "done" exists only in the reduced view,
-- derived from `step_marked` events. This is the storage under the phone
-- sheet (S3), the chat receipt (S2), export (S5), shift report (S6) and
-- Atlas (S7). S1 creates the tables and `JobSheetBody` + its validator only;
-- `job_sheets` / `job_sheet_revisions` (templates) are built on by S4.
--
-- PROMOTION: this file is applied to shared staging only after it moves into
-- db/migrations/ with a pure `git mv` (no edit), with Mike's OK. It is
-- idempotent and single-transaction so that move is safe.
--
-- TENANT FAMILY: UUID (kg/Hub family, .claude/rules/mira-hub-migrations.md
-- §1) because `work_sheet_events` hangs off `equipment_notebooks` (UUID).
-- TENSION: `work_order_id` is a bare TEXT column with NO foreign key — it
-- points at `work_orders.id`, which lives in the TEXT-tenant CMMS family
-- (§1). An FK here would force a cross-family cast that breaks for any
-- legacy slug tenant still in `cmms_equipment`/`work_orders`; the column is
-- left as an unenforced link instead (same tension `asset_fix_records`
-- (095) already lives with via `equipment_entity_id`).
--
-- RLS casts the setting in-type (§2) and honours both app.tenant_id and
-- app.current_tenant_id. GRANT SELECT, INSERT only: append-only for
-- factorylm_app (§3) on all three tables — no UPDATE, no DELETE. A
-- correction is a new event that points at the id it supersedes; a new job
-- sheet revision is a new row, never an edit of an old one.
--
-- TASK-S7 (finish job -> outbox -> Atlas work log): this file ALSO widens
-- the outbox's `notebook_domain_events_event_type_check` (111's inline CHECK)
-- to add 'job_finished', so a finished job sheet can enqueue one domain event
-- through the SAME outbox fix records use (src/capabilities/cmms-dispatch/**)
-- — no second delivery system. 'observation_recorded' (113's own widening) is
-- included too, deliberately, so 113 and 114 never narrow each other no
-- matter which one applies first on a given environment: each does a full
-- drop-and-re-add of the one shared CHECK, so whichever runs LAST wins, and
-- only listing every value either migration needs keeps that idempotent.
--
-- TASK-OUTBOX-CREATE-WO: this file ALSO widens the event_type CHECK a second
-- time to add 'work_order_requested' (one per technician-confirmed "request
-- an Atlas work order" action on a job sheet) and widens the delivery
-- `notebook_event_deliveries_operation_check` (111's inline CHECK, currently
-- `operation IN ('append_work_log')`) to add 'create_work_order' — the
-- SAME outbox dispatcher (cmms-dispatch/dispatcher.ts) branches on
-- `operation` rather than a second worker or table.
--
-- Rollback (old code never reads these objects). Run the whole block below
-- as ONE transaction. No other table's CHECK constraint or outbox references
-- these three, so the drop order only has to respect the in-schema FK
-- (job_sheet_revisions -> job_sheets): revisions first, then job_sheets,
-- then work_sheet_events. The outbox widening is unwound FIRST, before any
-- DROP TABLE: `job_finished` events are deleted (nothing else references
-- them — notebook_domain_events has no FK pointing at work_sheet_events),
-- then the CHECK is restored to the narrower ('fix_recorded',
-- 'observation_recorded') 113 left behind. NOTE: if 113's own rollback runs
-- AFTER this one on the same environment, its CHECK restore
-- (`('fix_recorded')`) will fail while any 'observation_recorded' row still
-- exists — same class of ordering tension 113 already documents; not fixed
-- here, just not worsened. DATA LOSS: this discards every job's event log,
-- every job sheet template and every template revision. If the history must
-- be kept, copy all three tables out first.
-- Executed by living-sheet.integration.test.ts
-- (documented_rollback_succeeds_after_a_job_started_event_exists).
-- ROLLBACK-BEGIN
--   BEGIN;
--   DELETE FROM notebook_event_deliveries WHERE operation = 'create_work_order';
--   DELETE FROM notebook_domain_events WHERE event_type = 'work_order_requested';
--   DELETE FROM notebook_domain_events WHERE event_type = 'job_finished';
--   ALTER TABLE notebook_event_deliveries DROP CONSTRAINT IF EXISTS notebook_event_deliveries_operation_check;
--   ALTER TABLE notebook_event_deliveries ADD CONSTRAINT notebook_event_deliveries_operation_check
--     CHECK (operation IN ('append_work_log'));
--   ALTER TABLE notebook_domain_events DROP CONSTRAINT IF EXISTS notebook_domain_events_event_type_check;
--   ALTER TABLE notebook_domain_events ADD CONSTRAINT notebook_domain_events_event_type_check
--     CHECK (event_type IN ('fix_recorded', 'observation_recorded'));
--   DROP TABLE IF EXISTS job_sheet_revisions;
--   DROP TABLE IF EXISTS job_sheets;
--   DROP TABLE IF EXISTS work_sheet_events;
--   COMMIT;
-- ROLLBACK-END

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS work_sheet_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  notebook_id           UUID NOT NULL REFERENCES equipment_notebooks(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL,
  seq                   INTEGER NOT NULL CHECK (seq >= 1),
  kind                  TEXT NOT NULL CHECK (kind IN (
                          'job_started', 'step_marked', 'reading_recorded', 'reading_corrected',
                          'note_added', 'question_resolved', 'part_logged', 'photo_attached',
                          'handover_written', 'job_finished'
                        )),
  payload               JSONB NOT NULL,
  client_event_id       UUID NOT NULL,
  request_fingerprint   TEXT NOT NULL,
  -- Link to work_orders.id; no FK — see the TENSION note above.
  work_order_id         TEXT NULL,
  -- Server-derived from the session (ctx.userId / ctx.email) — never
  -- accepted from the request body (TASK-S1 §Routes).
  actor_user_id         TEXT NULL,
  actor_label           TEXT NULL CHECK (char_length(actor_label) <= 200),
  -- Client clock, bounded: cannot be more than 5 minutes after recorded_at.
  occurred_at           TIMESTAMPTZ NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_sheet_events_occurred_not_future_chk
    CHECK (occurred_at <= recorded_at + interval '5 minutes'),
  CONSTRAINT work_sheet_events_job_seq_uniq UNIQUE (tenant_id, job_id, seq),
  CONSTRAINT work_sheet_events_notebook_client_event_uniq UNIQUE (tenant_id, notebook_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_work_sheet_events_job
  ON work_sheet_events (tenant_id, notebook_id, job_id, seq);

ALTER TABLE work_sheet_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_sheet_events_tenant_isolation ON work_sheet_events;
CREATE POLICY work_sheet_events_tenant_isolation ON work_sheet_events
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

GRANT SELECT, INSERT ON work_sheet_events TO factorylm_app;

-- job_sheets / job_sheet_revisions: reusable job sheet templates (S4 builds
-- the store + routes on top of these). S1 creates the schema only.

CREATE TABLE IF NOT EXISTS job_sheets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  created_by  TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE job_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_sheets_tenant_isolation ON job_sheets;
CREATE POLICY job_sheets_tenant_isolation ON job_sheets
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

GRANT SELECT, INSERT ON job_sheets TO factorylm_app;

CREATE TABLE IF NOT EXISTS job_sheet_revisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  job_sheet_id        UUID NOT NULL REFERENCES job_sheets(id) ON DELETE CASCADE,
  revision            INTEGER NOT NULL CHECK (revision >= 1),
  status              TEXT NOT NULL CHECK (status IN ('draft', 'reviewed')),
  body                JSONB NOT NULL,
  created_by          TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by         TEXT NULL,
  reviewed_at         TIMESTAMPTZ NULL,
  client_request_id   UUID NOT NULL,
  CONSTRAINT job_sheet_revisions_revision_uniq UNIQUE (job_sheet_id, revision),
  CONSTRAINT job_sheet_revisions_client_request_uniq UNIQUE (tenant_id, client_request_id),
  CONSTRAINT job_sheet_revisions_reviewed_chk
    CHECK ((status = 'reviewed') = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);

ALTER TABLE job_sheet_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_sheet_revisions_tenant_isolation ON job_sheet_revisions;
CREATE POLICY job_sheet_revisions_tenant_isolation ON job_sheet_revisions
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

GRANT SELECT, INSERT ON job_sheet_revisions TO factorylm_app;

-- Widen the outbox event vocabulary (111 created the CHECK inline, so its
-- auto-generated name is notebook_domain_events_event_type_check; 113 widens
-- it to add 'observation_recorded'). Include 'observation_recorded',
-- 'job_finished' AND 'work_order_requested' here so 113 and 114 never narrow
-- each other, whichever lands first on a given environment (see the header
-- note above). Drop-and-re-add is idempotent: the end state is the same
-- whichever run.
ALTER TABLE notebook_domain_events DROP CONSTRAINT IF EXISTS notebook_domain_events_event_type_check;
ALTER TABLE notebook_domain_events ADD CONSTRAINT notebook_domain_events_event_type_check
  CHECK (event_type IN ('fix_recorded', 'observation_recorded', 'job_finished', 'work_order_requested'));

-- Widen the delivery operation vocabulary (111's inline CHECK, auto-named
-- notebook_event_deliveries_operation_check) to add 'create_work_order' —
-- TASK-OUTBOX-CREATE-WO. 111 is the only migration that has ever touched
-- this CHECK, so there is no sibling-migration ordering tension here (unlike
-- the event_type CHECK above).
ALTER TABLE notebook_event_deliveries DROP CONSTRAINT IF EXISTS notebook_event_deliveries_operation_check;
ALTER TABLE notebook_event_deliveries ADD CONSTRAINT notebook_event_deliveries_operation_check
  CHECK (operation IN ('append_work_log', 'create_work_order'));

COMMENT ON TABLE work_sheet_events IS
  'Append-only Living Work Sheet event log (TASK-S1). One job on one confirmed machine; the current sheet is a pure reduce over these events. Never updated, never deleted.';
COMMENT ON TABLE job_sheets IS
  'Reusable job sheet templates. Schema only in S1 — S4 builds the store/routes.';
COMMENT ON TABLE job_sheet_revisions IS
  'Versioned revisions of a job_sheets template (draft -> reviewed). Schema only in S1 — S4 builds the store/routes.';

COMMIT;

BEGIN;

-- Migration 060: anomaly -> work-order provenance link (master-plan T4).
--
-- Context: docs/discovery/product-scoreboard.md §4.1 (Metric 7, "WO from
-- anomaly") found this genuinely NOT MEASURABLE — no linkage column exists
-- anywhere between a detected run_diff (038/040 machine-memory anomaly) and
-- a work_orders row. This is the smallest-addition proposal from that audit,
-- applied.
--
-- work_orders.tenant_id is TEXT (mira-core/mira-ingest/db/migrations/
-- 010_tenant_id_on_work_orders_telegram.sql), a different family than the
-- UUID kg/tag-event tables — see .claude/rules/mira-hub-migrations.md rule 1.
-- The new column itself is a plain UUID FK to run_diff.diff_id (also UUID,
-- 038_machine_runs.sql:210); the partial index pairs it with the table's own
-- (TEXT) tenant_id for the "work orders from anomalies, per tenant" query in
-- the scoreboard's Metric 7. No cross-family cast is needed because the two
-- columns are never compared to each other — only queried together.
--
-- FK is safe (not a soft-link) because run_diff.diff_id is a stable UUID PK
-- (038) and 038 is already applied everywhere 060 will run (migration order
-- guarantees 038 < 060 in the ledger). ON DELETE SET NULL: this is a
-- provenance back-link, not ownership — a work order must survive the (never
-- expected, run_diff is append-only/no-DELETE per 038) loss of its source
-- diff row. Same pattern as kg_relationships.relationship_proposal_id (050).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS (carries the FK) + CREATE INDEX IF NOT
-- EXISTS. Grants are unchanged — the column inherits work_orders' existing
-- table-level GRANTs to factorylm_app.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS source_run_diff_id UUID
    REFERENCES run_diff(diff_id) ON DELETE SET NULL;

-- "Work orders traced to a run_diff/anomaly" per tenant (scoreboard Metric 7).
CREATE INDEX IF NOT EXISTS idx_work_orders_source_run_diff
  ON work_orders (tenant_id, source_run_diff_id)
  WHERE source_run_diff_id IS NOT NULL;

COMMIT;

-- ─── DOWN ──────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_work_orders_source_run_diff;
-- ALTER TABLE work_orders
--   DROP COLUMN IF EXISTS source_run_diff_id;
-- COMMIT;

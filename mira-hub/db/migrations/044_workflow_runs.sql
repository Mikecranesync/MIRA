BEGIN;

-- Migration 044: workflow_runs — the shared durable-workflow run record.
--
-- Issue : #1758 (workflow durability — bring every surface to 10/10)
-- Audit : docs/research/2026-06-06-workflow-durability-audit.md
-- Wrappers:
--   Python — mira-bots/shared/workflow.py  (WorkflowRun async context manager)
--   TS     — mira-hub/src/lib/workflow.ts  (runWorkflow / WorkflowRun)
--
-- Why:
--   The audit's #1 systemic gap: 9 of 10 surfaces have no durable per-run
--   record. Criteria 3 (run record), 4 (run fields), 5 (step artifacts),
--   9 (status view) and 10 (smoke test) all cascade off this single primitive.
--   One table + a thin wrapper per surface lifts the whole codebase from
--   "fragile feature" to "observable workflow" without rearchitecting any one
--   surface. A run record makes the status view a `SELECT … ORDER BY started_at`
--   and the smoke test an "assert a success row exists in the last N hours".
--
-- Posture:
--   This is an admin-observability table, deliberately WITHOUT row-level
--   security — same posture as hub_uploads. tenant_id is a filter column, not
--   an RLS boundary, so the /workflows status page and cross-service writers
--   (Python bots, TS Hub, relay, lead-hunter) can read/write it without the
--   RLS-blocks-reads footgun. It contains operational metadata, not customer
--   plant data; PII in input/output/error_detail is sanitised by the wrapper
--   before insert.
--
-- Numbering:
--   037 is the live tail; 038–042 are reserved by #1677 (canonical asset-graph
--   sign-offs); 043 landed CMMS/tag relationship types. This takes 044.
--
-- Compatibility:
--   Pure additive — new table, no change to any existing object. DOWN drops it.

CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name    TEXT NOT NULL,                       -- 'pdf_ingest', 'kg_build', 'cmms_sync', …
  workflow_version TEXT NOT NULL DEFAULT '1.0.0',
  tenant_id        TEXT,
  status           TEXT NOT NULL DEFAULT 'running',     -- running | ok | degraded | failed
  input            JSONB,
  output           JSONB,
  error_detail     TEXT,
  step_artifacts   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{step_name, status, started_at, finished_at, artifact, error}]
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT,
  -- Guard the status enum at the DB so a buggy writer can't store garbage.
  CONSTRAINT workflow_runs_status_check
    CHECK (status IN ('running', 'ok', 'degraded', 'failed'))
);

-- Status-view query: "recent runs of workflow X by status".
CREATE INDEX IF NOT EXISTS idx_workflow_runs_name_status
  ON workflow_runs (workflow_name, status);

-- Status-view query: "this tenant's recent runs, newest first".
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant
  ON workflow_runs (tenant_id, started_at DESC);

-- Smoke-test query: "is there a recent run of any workflow?".
CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at
  ON workflow_runs (started_at DESC);

-- Idempotency dedup. A partial UNIQUE INDEX (not a table constraint — the
-- `UNIQUE(col) WHERE …` table-constraint form is invalid Postgres) so callers
-- can pass NULL freely while a non-NULL key gets ON CONFLICT DO NOTHING dedup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idempotency_key
  ON workflow_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE workflow_runs IS
  'Shared durable run record for every MIRA workflow surface. See migration 044 header and docs/research/2026-06-06-workflow-durability-audit.md.';

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN
-- ---------------------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS workflow_runs;
-- COMMIT;

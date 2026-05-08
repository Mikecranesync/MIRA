-- Migration 006: pipeline_runs
-- Tracks every KB ingest pipeline invocation (kb_growth_cron, full_ingest_pipeline,
-- and any future Celery-driven runs). One row per run; observability + alerting
-- read from this table.
--
-- Spec: docs/specs/kb-ingest-hardening-spec.md §4.2
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id                UUID PRIMARY KEY,
    tenant_id         TEXT NOT NULL DEFAULT 'mike',
    pdf_url           TEXT NOT NULL,
    manufacturer      TEXT,
    model             TEXT,
    doc_type          TEXT,
    status            TEXT NOT NULL,             -- pending|running|ok|failed|partial
    step_failed       TEXT,                      -- download|extract|chunk|embed|store|preflight|NULL
    chunks_created    INTEGER NOT NULL DEFAULT 0,
    bytes_downloaded  BIGINT,
    error             TEXT,                      -- last error, truncated to 500 chars at write
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ,
    duration_ms       INTEGER,
    pipeline_version  TEXT NOT NULL,             -- git sha of pipeline at run time
    metadata          JSONB DEFAULT '{}'::jsonb  -- step timings, retry counts, etc.
);

-- status + recency for the /api/kb/stats endpoint (latest runs first)
CREATE INDEX IF NOT EXISTS pipeline_runs_status_idx
    ON pipeline_runs (status, started_at DESC);

-- tenant scoping
CREATE INDEX IF NOT EXISTS pipeline_runs_tenant_idx
    ON pipeline_runs (tenant_id, started_at DESC);

-- Failure clustering ("which hosts are dying?")
CREATE INDEX IF NOT EXISTS pipeline_runs_failed_idx
    ON pipeline_runs (status, started_at DESC)
    WHERE status IN ('failed', 'partial');

COMMENT ON TABLE pipeline_runs IS
    'KB ingest pipeline run history — see docs/specs/kb-ingest-hardening-spec.md';
COMMENT ON COLUMN pipeline_runs.status IS
    'pending=queued, running=in-flight, ok=success, failed=hard failure, partial=text extracted but embed/store deferred';
COMMENT ON COLUMN pipeline_runs.pipeline_version IS
    'Git SHA of the pipeline code at run time. Used to invalidate stale cache + correlate regressions.';

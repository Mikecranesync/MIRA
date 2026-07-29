-- 055_decision_trace_confidence_and_feedback.sql
--
-- Phase 2 ("Why MIRA Thinks This"). Two additive changes to support surfacing a
-- decision trace to users and capturing trace-linked feedback:
--   1) decision_traces.confidence — the panel needs it; table 032 lacks it.
--   2) decision_trace_feedback — a trace-linked feedback store (correct / wrong /
--      missing_context / needs_review), replacing the fragile chat_id-keyed SQLite
--      feedback_log for the Hub surface and seeding Phase 10 consolidation.
--
-- decision_traces is the UUID tenant family (see 032 + .claude/rules/mira-hub-migrations.md):
-- tenant_id is UUID, RLS casts the setting to ::UUID, grants go to factorylm_app.
-- Idempotent + single transaction.

BEGIN;

-- 1) Confidence on the trace ('high' | 'medium' | 'low' | 'none' | NULL).
ALTER TABLE decision_traces
  ADD COLUMN IF NOT EXISTS confidence TEXT;

-- 2) Trace-linked feedback.
CREATE TABLE IF NOT EXISTS decision_trace_feedback (
    feedback_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id     UUID NOT NULL REFERENCES decision_traces(trace_id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL,
    verdict      TEXT NOT NULL CHECK (verdict IN ('good', 'bad', 'missing_context', 'needs_review')),
    note         TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dtf_trace  ON decision_trace_feedback (trace_id);
CREATE INDEX IF NOT EXISTS idx_dtf_tenant ON decision_trace_feedback (tenant_id);

ALTER TABLE decision_trace_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dtf_tenant ON decision_trace_feedback;
CREATE POLICY dtf_tenant ON decision_trace_feedback
    USING (
        tenant_id = current_setting('app.tenant_id', true)::UUID
        OR tenant_id = current_setting('app.current_tenant_id', true)::UUID
    )
    WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)::UUID
        OR tenant_id = current_setting('app.current_tenant_id', true)::UUID
    );

GRANT SELECT, INSERT ON decision_trace_feedback TO factorylm_app;
REVOKE UPDATE, DELETE ON decision_trace_feedback FROM PUBLIC;

COMMIT;

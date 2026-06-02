-- 036_decision_trace_session_link.sql
-- Purpose : Link troubleshooting_sessions to the most recent decision trace
--           written for that session. Allows the Hub session detail view to
--           fast-path to the latest trace without a secondary lookup.
-- Plan    : docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1 / §D2
-- Note    : FK not added here — decision_traces.trace_id is UUIDv7 caller-assigned;
--           the reverse FK (session → trace) would require the trace to be
--           committed first. The engine updates this column atomically with the
--           trace commit (Phase 8 writer: DecisionTraceWriter.commit()).

BEGIN;

ALTER TABLE troubleshooting_sessions
  ADD COLUMN IF NOT EXISTS last_decision_trace_id UUID;

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE troubleshooting_sessions
--   DROP COLUMN IF EXISTS last_decision_trace_id;
-- COMMIT;

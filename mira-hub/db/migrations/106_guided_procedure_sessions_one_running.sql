-- 106_guided_procedure_sessions_one_running.sql — at most one RUNNING guided session per
-- (tenant, notebook, procedure), so two devices pressing Start together share one session instead
-- of racing two (Codex #4573 F8). A deliberate "Start again" first moves the running session to
-- the new status 'restarted', then inserts the new one, in one transaction.
--
-- 105 is already applied to staging (migration-verify), so it is not edited; this is additive.
-- The status CHECK is replaced by name (Postgres' default name for 105's inline CHECK).
-- Idempotent, one transaction.

BEGIN;

ALTER TABLE guided_procedure_sessions DROP CONSTRAINT IF EXISTS guided_procedure_sessions_status_check;
ALTER TABLE guided_procedure_sessions ADD CONSTRAINT guided_procedure_sessions_status_check
  CHECK (status IN ('running', 'ok', 'degraded', 'failed', 'restarted'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_guided_procedure_sessions_one_running
  ON guided_procedure_sessions (tenant_id, notebook_id, template_id)
  WHERE status = 'running';

COMMIT;

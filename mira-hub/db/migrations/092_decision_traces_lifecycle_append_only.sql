-- Migration 092: the turn lifecycle is TWO APPENDED ROWS, not a mutated one.
--
-- WHY THIS EXISTS AND 091 WAS NOT EDITED
-- 091 is already applied to staging (run 35800416186). An applied migration is
-- immutable — `.claude/rules/mira-hub-migrations.md` §8, and migration 066's
-- content-sha detector fails the apply loudly if the bytes change. So the
-- correction lands here.
--
-- WHAT 091 GOT WRONG
-- It created `decision_traces_attempt_uk` UNIQUE (attempt_id), on the
-- assumption that a turn's outcome would UPDATE its start row. It cannot:
-- migration 032 grants the app role SELECT + INSERT and no more — "the app role
-- may read + insert, never mutate or delete" — because trace history must not
-- be rewritable from the request path. The first live window measured the
-- consequence exactly: started=7, closed=0, with_packet=0. Every close was
-- denied by the grant, which was doing its job.
--
-- Granting UPDATE would have traded an audit invariant for convenience. Instead
-- a lifecycle is one `started` row and one `closed` row sharing an
-- `attempt_id`; the close appends and never touches the start.
--
-- Uniqueness therefore moves from (attempt_id) to (attempt_id, lifecycle):
-- still at most one start and one outcome per attempt, so a retried write or a
-- double-close is absorbed by the conflict rather than duplicating the ledger.

BEGIN;

DROP INDEX IF EXISTS decision_traces_attempt_uk;

CREATE UNIQUE INDEX IF NOT EXISTS decision_traces_attempt_lifecycle_uk
    ON decision_traces (attempt_id, lifecycle) WHERE attempt_id IS NOT NULL;

COMMIT;

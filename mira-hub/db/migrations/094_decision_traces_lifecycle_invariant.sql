-- Migration 094: make the lifecycle invariant STRUCTURAL, not conventional.
--
-- From the Gate 7 adversarial review of PR #3964 (finding 1, severity high).
--
-- THE FINDING, AND WHAT IS ACTUALLY TRUE
-- 091 declared `lifecycle TEXT NOT NULL DEFAULT 'closed'`. The reviewer argued a
-- writer that sets `attempt_id` but OMITS `lifecycle` silently produces a
-- `closed` row, so the real close later collides on the
-- `(attempt_id, lifecycle)` unique index and the outcome is lost.
--
-- As described, that is refuted: every writer that sets `attempt_id` also sets
-- `lifecycle` explicitly (`turn-lifecycle.ts` twice, `persist-usage.ts` once),
-- and the only writer that omits it — `assets/[id]/chat` — sets no `attempt_id`
-- either, so its rows are excluded from the partial index and from every
-- lifecycle query. The `'closed'` default is load-bearing for exactly that
-- reason: it keeps every pre-091 row and every non-lifecycle writer meaning
-- what it has always meant.
--
-- But the reviewer is right that the invariant is only a CONVENTION. A future
-- writer could set `attempt_id`, omit `lifecycle`, and fail SILENTLY — the
-- worst possible failure for a table whose entire job is to notice silence.
--
-- So: an attempt-bearing row that claims to be finished must SAY how it
-- finished. A writer that omits `lifecycle` also omits `outcome`, so it now
-- fails loudly at the constraint instead of quietly poisoning the ledger. The
-- default stays; the hole it left does not.
--
-- Verified against staging before writing: 0 rows violate this
-- (31 051 closed / 44 started), so the ALTER cannot fail on existing data.
--
-- NOT VALID is deliberately NOT used: the table is small enough to validate in
-- place, and a constraint that has never been checked is a constraint nobody
-- can trust.

BEGIN;

ALTER TABLE decision_traces
    DROP CONSTRAINT IF EXISTS decision_traces_closed_has_outcome;

ALTER TABLE decision_traces
    ADD CONSTRAINT decision_traces_closed_has_outcome
    CHECK (lifecycle <> 'closed' OR attempt_id IS NULL OR outcome IS NOT NULL);

COMMIT;

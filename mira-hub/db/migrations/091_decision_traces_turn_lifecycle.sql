-- Migration 091: decision_traces gains a TURN LIFECYCLE — a durable start
-- record and an eventual outcome for every accepted turn.
--
-- Claim #3939, "User priority update — complete interaction capture".
--
-- THE DEFECT THIS CLOSES
-- Until now the Turn Evidence Packet was written EXACTLY ONCE, at the end, by
-- `persistTurnUsage` — which is a *usage* persist on the successful generation
-- path. So a turn that timed out, was cancelled by the client, failed the
-- provider cascade, or died before generation left NO ROW AT ALL. The recorder
-- could not distinguish "never happened" from "happened and vanished", and any
-- coverage number computed from these rows was self-confirming: it counted only
-- the turns that survived to be counted.
--
-- A start record is written the moment a turn is ACCEPTED (after auth and
-- validation, before any provider or retrieval work). Every exit path then
-- closes it. A row still `started` well past any plausible turn is an ORPHAN,
-- and orphans are the honest measure of capture loss.
--
-- NO SECOND REGISTRY (materialized-evidence rule 15). This extends the one
-- canonical per-turn ledger `decision_traces` — the same row 090 extended —
-- rather than forking a lifecycle table beside it.
--
-- COLUMNS
--   attempt_id   — server-minted uuid for THIS accepted attempt. Distinct from
--                  turn_id (which only exists once a turn row is written) and
--                  from client_request_id (client-supplied, absent on some
--                  surfaces, and reused across retries by design — 088). This
--                  is the key the start record and its outcome share.
--   lifecycle    — 'started' | 'closed'. Exactly two states on purpose: the
--                  interesting question is "did it ever finish", and a richer
--                  enum invites rows that are neither.
--   outcome      — how it ended, once closed: answered | refused | abstained |
--                  safety_stop | error | timeout | cancelled | superseded.
--                  NULL while started.
--   started_at   — when the turn was accepted (NOT `ts`, which 070 sets at
--                  insert and which a close would otherwise leave meaningless).
--   finished_at  — when the outcome was written. NULL while started.
--
-- `lifecycle` defaults to 'closed' so every PRE-091 row and every writer that
-- has not adopted the lifecycle (the bot surfaces, telegram/slack/ignition)
-- keeps its exact current meaning: a row that exists is a turn that finished.
-- Only a writer that explicitly opens a turn can create a 'started' row, so the
-- orphan query can never be poisoned by a legacy writer.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- throughout; safe to re-run (apply-migrations may).

BEGIN;

ALTER TABLE decision_traces
    ADD COLUMN IF NOT EXISTS attempt_id  UUID,
    ADD COLUMN IF NOT EXISTS lifecycle   TEXT NOT NULL DEFAULT 'closed',
    ADD COLUMN IF NOT EXISTS outcome     TEXT,
    ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- One row per accepted attempt. The close is an UPDATE keyed on this, so a
-- duplicate start (a retried write, a double-submit) can never produce two
-- ledger rows for one turn. Partial: legacy rows have attempt_id NULL and must
-- not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS decision_traces_attempt_uk
    ON decision_traces (attempt_id) WHERE attempt_id IS NOT NULL;

-- The reconciliation query: unfinished turns, oldest first. Partial so the
-- index stays small — 'started' is a transient state measured in seconds, and
-- the index should hold only the rows a reconciler actually scans.
CREATE INDEX IF NOT EXISTS decision_traces_unfinished_idx
    ON decision_traces (started_at) WHERE lifecycle = 'started';

-- Coverage by outcome over a window, without scanning the whole ledger.
CREATE INDEX IF NOT EXISTS decision_traces_outcome_ts_idx
    ON decision_traces (environment, outcome, ts DESC);

COMMIT;

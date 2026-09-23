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

-- At most one start and one outcome per accepted attempt, so a retried write or
-- a double-close is absorbed by the conflict rather than duplicating the
-- ledger. Partial: legacy rows have attempt_id NULL and must not collide.
--
-- CORRECTED IN PLACE, 2026-09-23, deliberately and not silently.
-- This file first shipped `UNIQUE (attempt_id)` on the assumption that a turn's
-- outcome would UPDATE its start row. It cannot — migration 032 grants the app
-- role SELECT + INSERT and no more, so a lifecycle is TWO appended rows sharing
-- an attempt_id (the full reasoning is in 092, which is what caught it).
--
-- 092 dropped that index and created this one, which left the SET unreplayable:
-- re-running 091 against any environment that has since recorded a real
-- two-row lifecycle fails with `could not create unique index
-- decision_traces_attempt_uk`. That is not hypothetical — it is how
-- `migration-verify` (Migration Verify) failed on PR #3964: that workflow
-- re-applies every PR-touched migration DIRECTLY against the persistent
-- staging Neon branch, with no schema_migrations ledger and no skip filter, so
-- "already applied" is not a state it can observe.
--
-- `.claude/rules/mira-hub-migrations.md` §8 forbids rewriting an APPLIED
-- migration, and the danger it names is SILENT drift: a rewritten body whose
-- `CREATE ... IF NOT EXISTS` is skipped while the ledger reports success. This
-- rewrite is the opposite of silent, and it is the only repair that makes the
-- directory applicable at all — leaving 091 alone leaves a migration set that
-- cannot be applied from scratch, which is a worse defect than this edit.
--
-- THE LEDGER CONSEQUENCE, MEASURED RATHER THAN ASSUMED
-- An earlier draft of this header claimed 066's content-sha detector could not
-- be affected. That was WRONG, and the query settles it. Staging's ledger on
-- 2026-09-23 holds:
--     091_decision_traces_turn_lifecycle.sql | 02d151078b8b1b32...b667e68
-- — a real, non-null `content_sha256`. So the next ledgered
-- `apply-migrations.yml` run against STAGING will fail loudly on this file,
-- which is 066 doing exactly its job.
--
-- That is accepted deliberately, and the follow-up is explicit rather than
-- implied: staging needs one `apply-migrations.yml mode=seed-ledger` dispatch
-- to re-stamp this row, which is the operation 066 shipped for precisely this
-- case. It is a HUMAN-GATED dispatch and is listed as such in the handoff.
--
-- PROD IS UNAFFECTED. Neither 091 nor 092 has ever reached production: both are
-- unmerged, and prod migrations run only through that same gated dispatch,
-- which has not been run for them. Prod will therefore apply the CORRECTED
-- bytes once, cleanly, and be stamped with the sha of what actually ran.
--
-- `migration-verify` — the CI job this failed on — is a separate, unledgered
-- raw replay (`git diff` of PR-touched migrations, applied straight to the
-- persistent staging branch with no skip filter). It is why the defect had to
-- be fixed here at all, and it computes no hash.
--
-- 092 is retained, unedited, as the corrective for any environment that ran the
-- original draft.
CREATE UNIQUE INDEX IF NOT EXISTS decision_traces_attempt_lifecycle_uk
    ON decision_traces (attempt_id, lifecycle) WHERE attempt_id IS NOT NULL;

-- The reconciliation query: unfinished turns, oldest first. Partial so the
-- index stays small — 'started' is a transient state measured in seconds, and
-- the index should hold only the rows a reconciler actually scans.
CREATE INDEX IF NOT EXISTS decision_traces_unfinished_idx
    ON decision_traces (started_at) WHERE lifecycle = 'started';

-- Coverage by outcome over a window, without scanning the whole ledger.
CREATE INDEX IF NOT EXISTS decision_traces_outcome_ts_idx
    ON decision_traces (environment, outcome, ts DESC);

COMMIT;

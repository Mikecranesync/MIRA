-- Migration 090: decision_traces gains the Turn Evidence Packet + OTel
-- correlation columns (Turn Flight Recorder, I3).
--
-- Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
-- §4 "Turn Evidence Packet". Claim #3939, branch feat/otel-turn-flight-recorder.
--
-- WHY 090 AND NOT THE NEXT INTEGER AFTER 089 BLINDLY
-- 089 (`notebook_turn_request_claim`) is the highest filename on main at the
-- time this was authored; 090 is the next free integer. No gap, no collision.
--
-- WHAT THIS ENABLES
-- The Turn Flight Recorder (design doc, full context) instruments the Hub
-- notebook-chat/look request path with OpenTelemetry spans AND a compact,
-- PII-free "Turn Evidence Packet" summarizing which stages ran, what evidence
-- reached the model, and how the turn was decided. `decision_traces` is
-- already the canonical per-turn ledger (rule §15, materialized-evidence: no
-- second registry) — this extends that ONE row rather than forking a new
-- table. `evidence_packet` carries ids/counts/flags only (see the TS type in
-- `src/capabilities/observability/turn-evidence-packet.ts`); it never carries
-- message/answer/prompt text — the existing `user_question`/`recommendation`
-- columns keep their current PII-sanitized behavior unchanged.
--
-- COLUMNS
--   otel_trace_id     — 32-hex OpenTelemetry trace id minted by the SDK at
--                        request ingress. NULL when the SDK did not start
--                        (no OTLP endpoint configured) or the write predates
--                        this instrumentation.
--   turn_id            — equipment_notebook_turns.id for this turn. NO FK: this
--                        is a cross-runtime ledger (bot surfaces write rows
--                        with no equipment_notebook_turns row at all — see
--                        migration 070's header), so a hard FK would reject
--                        those rows. Correlation, not referential integrity.
--   client_request_id — mirrors equipment_notebook_turns.client_request_id
--                        (088) so a packet can be found starting from either
--                        side without a join through turn_id.
--   notebook_id        — equipment_notebooks.id. Same no-FK reasoning as
--                        turn_id: non-notebook platforms (telegram/slack/
--                        ignition) never populate it.
--   environment         — deployment.environment.name (staging/production/dev)
--                        the turn ran under, from the OTel resource attribute.
--   git_sha             — the deployed commit the turn ran under.
--   evidence_packet     — JSONB, the TurnEvidencePacket (see TS type). Ids,
--                        counts, booleans, timings only — never free text.
--   anomalies           — JSONB array of deterministic anomaly codes computed
--                        from the packet (see anomalies.ts). Defaults to an
--                        empty array so every row (old and new) reads as
--                        "no anomalies detected", never "unknown".
--
-- TENANT TYPE — decision_traces.tenant_id is TEXT since migration 070. None
-- of these columns touch tenant_id; no ALTER-ordering dance (rule §4) needed.
--
-- GRANTS — migration 032 already grants SELECT, INSERT on decision_traces to
-- factorylm_app (rule §3). This migration adds columns only; no new grant.
--
-- POLICY — untouched. The existing decision_traces_tenant RLS policy (070)
-- applies to these columns automatically; no DROP/CREATE POLICY needed since
-- no column referenced by that policy is altered (rule §4 only applies to
-- ALTER COLUMN TYPE, not ADD COLUMN).
--
-- Idempotent (`IF NOT EXISTS` throughout), additive-only, single transaction.
-- No backfill: every historical row reads otel_trace_id/turn_id/evidence_packet
-- as NULL and anomalies as '[]', which is the correct reading ("written before
-- this instrumentation existed"), not "known-clean".
--
-- Applied via migration-verify (staging) / apply-migrations.yml (prod) only.
-- NOT applied to production by this change.
--
-- Rollback:
--   BEGIN;
--   DROP INDEX IF EXISTS decision_traces_otel_trace_idx;
--   DROP INDEX IF EXISTS decision_traces_turn_idx;
--   DROP INDEX IF EXISTS decision_traces_notebook_ts_idx;
--   ALTER TABLE decision_traces
--     DROP COLUMN IF EXISTS otel_trace_id,
--     DROP COLUMN IF EXISTS turn_id,
--     DROP COLUMN IF EXISTS client_request_id,
--     DROP COLUMN IF EXISTS notebook_id,
--     DROP COLUMN IF EXISTS environment,
--     DROP COLUMN IF EXISTS git_sha,
--     DROP COLUMN IF EXISTS evidence_packet,
--     DROP COLUMN IF EXISTS anomalies;
--   COMMIT;

BEGIN;

ALTER TABLE decision_traces
    ADD COLUMN IF NOT EXISTS otel_trace_id     TEXT,
    ADD COLUMN IF NOT EXISTS turn_id           UUID,
    ADD COLUMN IF NOT EXISTS client_request_id TEXT,
    ADD COLUMN IF NOT EXISTS notebook_id       UUID,
    ADD COLUMN IF NOT EXISTS environment       TEXT,
    ADD COLUMN IF NOT EXISTS git_sha           TEXT,
    ADD COLUMN IF NOT EXISTS evidence_packet   JSONB,
    ADD COLUMN IF NOT EXISTS anomalies         JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS decision_traces_otel_trace_idx ON decision_traces (otel_trace_id);
CREATE INDEX IF NOT EXISTS decision_traces_turn_idx       ON decision_traces (turn_id);
CREATE INDEX IF NOT EXISTS decision_traces_notebook_ts_idx ON decision_traces (notebook_id, ts DESC);

COMMENT ON COLUMN decision_traces.otel_trace_id IS
    '32-hex OpenTelemetry trace id minted at request ingress by the Node SDK. '
    'NULL when the SDK was not started (no OTLP endpoint) or the row predates '
    'the Turn Flight Recorder.';

COMMENT ON COLUMN decision_traces.turn_id IS
    'equipment_notebook_turns.id for this turn, when the platform is a '
    'notebook surface. Deliberately no FK — this ledger also receives rows '
    'from non-notebook platforms (telegram/slack/ignition) that have no '
    'equipment_notebook_turns row at all (see migration 070).';

COMMENT ON COLUMN decision_traces.evidence_packet IS
    'TurnEvidencePacket (src/capabilities/observability/turn-evidence-packet.ts, '
    'v"1"): ids, counts, booleans and timings describing which stages ran and '
    'what evidence reached the model. NEVER message/answer/prompt/chunk text — '
    'that stays on the existing user_question/recommendation columns under '
    'their current PII-sanitized contract.';

COMMENT ON COLUMN decision_traces.anomalies IS
    'Deterministic anomaly codes (anomalies.ts::AnomalyCode) computed from '
    'evidence_packet at write time. Defaults to the empty array, so every row '
    '(including pre-090 history) reads as "no anomalies detected".';

COMMIT;

-- Migration 111: notebook_domain_events (transactional outbox) +
-- notebook_event_deliveries (per-destination delivery ledger) +
-- tenant_cmms_config.write_policy (connection-level opt-in).
--
-- WHY (issue #5020 — trusted interaction loop, slices B + C)
-- A technician's accepted record (today: a recorded fix, asset_fix_records /
-- migration 095) must become ONE durable domain event in the SAME transaction
-- as the record itself, and reach the linked CMMS work order through a worker
-- with a receipt and read-back verification — never fire-and-forget from the
-- web request, never a second conversation database. There is no outbox in the
-- canonical Hub DB today (catalog A7 §1: the only outbox is the bot's local
-- SQLite wo_outbox); the equipment_notebook_turns lease pattern (089) is a
-- single-row claim, not a queue.
--
-- SHAPE
--   notebook_domain_events — APPEND-ONLY. One row per accepted case change.
--     aggregate_key + sequence give per-case ordering (a delayed older event
--     can never overtake a newer one at delivery time); correlation_id /
--     causation_id carry provenance (a later fix on the same notebook+asset
--     supersedes the earlier one: causation_id = the superseded event). payload
--     holds only the permitted structured fields (never a notebook URL, never
--     model output). subject_ref is unique per (tenant, event_type) so a retried
--     client request can never enqueue a second event for the same record.
--   notebook_event_deliveries — one row per (event, destination, operation).
--     A successful context projection and a CMMS delivery are separate rows;
--     one never marks the other delivered. state is the honest delivery state
--     (queued → leased → accepted_pending_verification → verified_by_readback,
--     or conflict / unsupported / permission_denied / retryable_failure /
--     permanent_failure / outcome_unknown / quarantined / blocked_policy).
--     lease_token + lease_until let a worker claim under FOR UPDATE SKIP LOCKED
--     and let a stale worker's late write be rejected (WHERE lease_token = $x).
--     dedupe_key = tenant|connection|event|operation — at-least-once delivery
--     with explicit deduplication, NOT an exactly-once claim.
--   tenant_cmms_config.write_policy — JSONB, default '{}' = nothing is ever
--     dispatched for the tenant. Explicit connection-level opt-in only; a global
--     flag alone never enables write-back for any customer.
--
-- TENANT FAMILY: UUID (kg/Hub family, .claude/rules/mira-hub-migrations.md §1)
-- — these rows hang off equipment_notebooks / asset_fix_records, both UUID.
-- RLS casts the setting in-type (current_setting(...)::uuid), both
-- app.tenant_id and app.current_tenant_id honored — identical shape to 095.
-- GRANT to factorylm_app in this migration (rule §3). The dispatcher worker
-- claims across tenants on the pool owner connection (same precedent as
-- src/lib/atlas/sync.ts) and then does every tenant-scoped read/write under
-- withTenantContext.
--
-- tenant_cmms_config.tenant_id is TEXT (CMMS family, 008); the policy lookup
-- compares `tenant_id = $1::text`, no cross-cast (rule §2).
--
-- Idempotent, additive-only, single transaction. lock_timeout bounded per
-- #5010/#5017. Applied via migration-verify (staging, on PR) /
-- apply-migrations.yml (prod) only.
-- Rollback (old code never reads these objects):
--   DROP TABLE IF EXISTS notebook_event_deliveries;
--   DROP TABLE IF EXISTS notebook_domain_events;
--   ALTER TABLE tenant_cmms_config DROP COLUMN IF EXISTS write_policy;

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS notebook_domain_events (
  event_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version      INTEGER NOT NULL DEFAULT 1,
  tenant_id           UUID NOT NULL,
  notebook_id         UUID NOT NULL,
  turn_id             UUID NULL,
  thread_id           TEXT NULL,
  -- kg_entities.entity_id of the bound asset at record time (cmms_equipment
  -- UUID as text) — mirrors asset_fix_records.equipment_entity_id (095).
  equipment_entity_id TEXT NULL,
  -- Point-in-time UNS path snapshot (never backfilled) — mirrors
  -- equipment_notebook_turns.asset_uns_path (081).
  asset_uns_path      TEXT NULL,
  aggregate_key       TEXT NOT NULL,
  sequence            BIGINT NOT NULL CHECK (sequence > 0),
  event_type          TEXT NOT NULL CHECK (event_type IN ('fix_recorded')),
  occurred_at         TIMESTAMPTZ NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- hub_users.id of the technician (server-derived). Exported only as a label.
  actor_user_id       TEXT NULL,
  origin_system       TEXT NOT NULL DEFAULT 'mira_hub' CHECK (origin_system IN ('mira_hub')),
  information_status  TEXT NOT NULL CHECK (information_status IN ('technician_reported')),
  correlation_id      UUID NOT NULL,
  causation_id        UUID NULL,
  policy_version      TEXT NOT NULL,
  -- '<table>:<row id>' of the canonical record this event describes.
  subject_ref         TEXT NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT notebook_domain_events_aggregate_seq_uniq UNIQUE (aggregate_key, sequence),
  CONSTRAINT notebook_domain_events_subject_uniq UNIQUE (tenant_id, event_type, subject_ref)
);

CREATE INDEX IF NOT EXISTS idx_notebook_domain_events_tenant_notebook
  ON notebook_domain_events (tenant_id, notebook_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS notebook_event_deliveries (
  delivery_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  event_id          UUID NOT NULL REFERENCES notebook_domain_events(event_id) ON DELETE CASCADE,
  aggregate_key     TEXT NOT NULL,
  destination       TEXT NOT NULL CHECK (destination IN ('cmms')),
  -- tenant_cmms_config.provider at enqueue time (e.g. 'atlas').
  connection_key    TEXT NOT NULL,
  operation         TEXT NOT NULL CHECK (operation IN ('append_work_log')),
  dedupe_key        TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
                      'queued',
                      'leased',
                      'accepted_pending_verification',
                      'verified_by_readback',
                      'conflict',
                      'unsupported',
                      'permission_denied',
                      'retryable_failure',
                      'permanent_failure',
                      'outcome_unknown',
                      'quarantined',
                      'blocked_policy'
                    )),
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token       UUID NULL,
  lease_until       TIMESTAMPTZ NULL,
  -- Destination-side identifier of the delivered record (e.g. an Atlas
  -- comment id). NULL until the destination acknowledged something.
  external_ref      TEXT NULL,
  last_error        TEXT NULL,
  -- Sanitized machine-readable receipt: probe results, HTTP statuses, counts,
  -- timings. Never credentials, never the technician's words.
  receipt           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notebook_event_deliveries_dedupe_uniq UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notebook_event_deliveries_due
  ON notebook_event_deliveries (next_attempt_at)
  WHERE state IN ('queued', 'retryable_failure', 'outcome_unknown', 'accepted_pending_verification');

CREATE INDEX IF NOT EXISTS idx_notebook_event_deliveries_event
  ON notebook_event_deliveries (event_id);

CREATE INDEX IF NOT EXISTS idx_notebook_event_deliveries_aggregate
  ON notebook_event_deliveries (aggregate_key, created_at);

ALTER TABLE notebook_domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notebook_domain_events_tenant_isolation ON notebook_domain_events;
CREATE POLICY notebook_domain_events_tenant_isolation ON notebook_domain_events
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- Append-only for the app role: SELECT + INSERT. No UPDATE, no DELETE.
GRANT SELECT, INSERT ON notebook_domain_events TO factorylm_app;

ALTER TABLE notebook_event_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notebook_event_deliveries_tenant_isolation ON notebook_event_deliveries;
CREATE POLICY notebook_event_deliveries_tenant_isolation ON notebook_event_deliveries
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- The app role enqueues (INSERT) and reports status (SELECT); the dispatcher
-- updates delivery state. No DELETE: rollback/disable stops dispatch, it never
-- removes queued events.
GRANT SELECT, INSERT, UPDATE ON notebook_event_deliveries TO factorylm_app;

ALTER TABLE tenant_cmms_config
  ADD COLUMN IF NOT EXISTS write_policy JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE notebook_domain_events IS
  'Append-only transactional outbox of accepted notebook case changes (#5020). One row per accepted record; payload carries permitted structured fields only.';
COMMENT ON TABLE notebook_event_deliveries IS
  'Per-destination delivery ledger for notebook_domain_events (#5020): honest delivery states, lease, bounded retries, sanitized receipt. At-least-once with explicit deduplication.';
COMMENT ON COLUMN tenant_cmms_config.write_policy IS
  'Connection-level write-back opt-in (#5020). {} = never dispatch. Shape: {"version":1,"fix_recorded":{"enabled":bool,"operation":"append_work_log","target":{"kind":"asset_linked_work_order"}|{"kind":"work_order","externalWorkOrderId":"…"},"internal_test":bool}}.';

COMMIT;

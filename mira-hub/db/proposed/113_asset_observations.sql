-- Migration 113 (PROPOSED — not in db/migrations/ on purpose): technician
-- observations on a confirmed machine (Mission 001, observation state).
--
-- WHY: a technician's confirmed human report ("seal leaking at 09:10") was
-- only ever a chat turn. No record, no projection into asset state, nothing
-- a second technician on the same machine could recover. This table is the
-- append-only evidence row; the same transaction writes one
-- notebook_domain_events row (event_type 'observation_recorded', no delivery
-- row: observations are never dispatched to a CMMS).
--
-- PROMOTION: this file is applied to shared staging only after it moves into
-- db/migrations/ with a pure `git mv` (no edit). It is idempotent and
-- single-transaction so that move is safe.
--
-- TENANT FAMILY: UUID (kg/Hub family, .claude/rules/mira-hub-migrations.md §1)
-- because it hangs off equipment_notebooks (UUID). equipment_entity_id is TEXT
-- like asset_fix_records.equipment_entity_id (095). RLS casts the setting
-- in-type and honours both app.tenant_id and app.current_tenant_id (§2).
-- GRANT SELECT, INSERT only: append-only for factorylm_app (§3). No UPDATE,
-- no DELETE. Corrections are new rows that point at the old one.
--
-- supersedes_id: ON DELETE SET NULL. A superseding row may live in another
-- notebook of the same asset, so a plain NO ACTION FK would make deleting the
-- older notebook fail. The link is dropped instead (the older row is gone with it).
--
-- Rollback (old code never reads these objects):
--   DROP TABLE IF EXISTS asset_observations;
--   ALTER TABLE notebook_domain_events DROP CONSTRAINT IF EXISTS notebook_domain_events_event_type_check;
--   ALTER TABLE notebook_domain_events ADD CONSTRAINT notebook_domain_events_event_type_check CHECK (event_type IN ('fix_recorded'));

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS asset_observations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  notebook_id           UUID NOT NULL,
  -- Confirmed binding at record time (observations refuse unbound/unconfirmed notebooks).
  equipment_entity_id   TEXT NOT NULL,
  -- Point-in-time UNS path snapshot from the binding (mirrors 081 / 111).
  asset_uns_path        TEXT NULL,
  fact_key              TEXT NOT NULL CHECK (fact_key IN ('seal_leak', 'abnormal_noise', 'vibration', 'overheating')),
  fact_value            TEXT NOT NULL CHECK (fact_value IN ('present', 'absent', 'repaired')),
  -- The technician's words as confirmed. Bounded; never a model paraphrase.
  raw_report            TEXT NOT NULL CHECK (char_length(raw_report) <= 1000),
  -- Optional answer turn; the store checks it belongs to this notebook.
  source_turn_id        UUID NULL,
  observed_at           TIMESTAMPTZ NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- hub_users.id of the technician (server-derived).
  recorded_by           TEXT NULL,
  verification_method   TEXT NOT NULL CHECK (verification_method IN ('self_reported', 'attested', 'machine')),
  uncertainty           TEXT NOT NULL DEFAULT 'unverified' CHECK (uncertainty IN ('unverified', 'uncertain')),
  supersedes_id         UUID NULL,
  client_request_id     UUID NOT NULL,
  request_fingerprint   TEXT NOT NULL,
  projector_version     TEXT NOT NULL,
  CONSTRAINT asset_observations_observed_not_future_chk
    CHECK (observed_at <= recorded_at + interval '5 minutes'),
  CONSTRAINT asset_observations_request_uniq UNIQUE (tenant_id, client_request_id),
  CONSTRAINT asset_observations_notebook_fk
    FOREIGN KEY (notebook_id) REFERENCES equipment_notebooks(id) ON DELETE CASCADE,
  CONSTRAINT asset_observations_supersedes_fk
    FOREIGN KEY (supersedes_id) REFERENCES asset_observations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_observations_asset_fact
  ON asset_observations (tenant_id, equipment_entity_id, fact_key, observed_at DESC);

ALTER TABLE asset_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_observations_tenant_isolation ON asset_observations;
CREATE POLICY asset_observations_tenant_isolation ON asset_observations
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- Append-only for the app role.
GRANT SELECT, INSERT ON asset_observations TO factorylm_app;

-- Widen the outbox event vocabulary (111 created the CHECK inline, so its
-- auto-generated name is notebook_domain_events_event_type_check).
-- Drop-and-re-add is idempotent: the end state is the same whichever run.
ALTER TABLE notebook_domain_events DROP CONSTRAINT IF EXISTS notebook_domain_events_event_type_check;
ALTER TABLE notebook_domain_events ADD CONSTRAINT notebook_domain_events_event_type_check
  CHECK (event_type IN ('fix_recorded', 'observation_recorded'));

COMMENT ON TABLE asset_observations IS
  'Append-only technician observations on a confirmed machine (Mission 001). Human-reported evidence: never a machine measurement, never root cause, health or safe-to-operate.';

COMMIT;

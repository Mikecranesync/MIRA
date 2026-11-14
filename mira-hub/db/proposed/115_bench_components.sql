-- Migration 115 (PROPOSED — kept in db/proposed/ on purpose): bench components,
-- their identity revisions, and the component each conversation is asking about
-- (whole-bench component workflow, Mike 2026-11-14; issue #5499).
--
-- WHY: a machine notebook (one project holding the drive manual, the PLC guide,
-- the relay datasheet and the print set) has no single identity, and the only
-- way to say which unit a question was about was to type it. Every spelling of
-- "GS11N-20P2" and of "back to mine" became a parser case (#5464–#5496).
-- These tables let the technician list every component on the bench, confirm
-- what each one is, and pick the one a conversation is about — as stored,
-- validated state. Nothing here is read by the chat route unless the client
-- sends a component selection, so a deploy without this migration changes
-- nothing for existing conversations.
--
-- PROMOTION: this file reaches shared staging only after it moves into
-- db/migrations/ with a pure `git mv` (no edit), after review. migration-verify
-- auto-applies anything under db/migrations/ to staging on every PR push, and an
-- applied migration is immutable (.claude/rules/mira-hub-migrations.md §8), so
-- the shape is settled here first. Idempotent and single-transaction.
--
-- TENANT FAMILY: UUID (kg/Hub family, §1) — every table hangs off
-- equipment_notebooks (UUID). RLS casts the setting in-type and honours both
-- app.tenant_id and app.current_tenant_id (§2). Owner/user ids are TEXT
-- (hub_users.id), as on equipment_notebook_turns.owner_user_id (086).
--
-- notebook_components: one row per physical component on the bench checklist.
--   The id is the stable identity of the PART; what the part IS lives in its
--   revisions. retired_at hides a row without deleting it (earlier turns and
--   revisions still point at it).
-- notebook_component_revisions: append-only (GRANT SELECT, INSERT). A
--   correction is a new revision. raw_label is what the plate or the technician
--   said, verbatim. Fields the technician marked "Not sure" are listed in
--   `unresolved` and stored NULL — never guessed. identity_status is
--   user_confirmed only together with confirmed_at (CHECK).
-- notebook_thread_selections: the component one technician's conversation is
--   asking about. thread_key is the turn's thread_id, or 'legacy' for the
--   pre-087 default conversation (equipment-notebooks.ts LEGACY_THREAD_ID).
--   selected_at moves on every explicit pick or Return; it is the boundary the
--   model carry reads from (capabilities/bench-components/selection.ts).
--   version is the compare-and-set counter a client sends back.
-- equipment_notebook_turns.component_id / component_revision: which component
--   (and which of its identities) a turn was asked under. Point-in-time, never
--   backfilled. ON DELETE SET NULL keeps the turn if its component is deleted.
--
-- Rollback (old code never reads these objects). Run as ONE transaction.
-- DATA LOSS: discards every bench component, revision and selection. Turns keep
-- their text; only the component stamp goes.
-- ROLLBACK-BEGIN
--   BEGIN;
--   ALTER TABLE equipment_notebook_turns DROP COLUMN IF EXISTS component_revision;
--   ALTER TABLE equipment_notebook_turns DROP COLUMN IF EXISTS component_id;
--   DROP TABLE IF EXISTS notebook_thread_selections;
--   DROP TABLE IF EXISTS notebook_component_revisions;
--   DROP TABLE IF EXISTS notebook_components;
--   COMMIT;
-- ROLLBACK-END

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS notebook_components (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  notebook_id        UUID NOT NULL,
  -- Checklist order.
  position           INTEGER NOT NULL DEFAULT 0,
  -- What kind of part this is on the checklist (drive, relay, ...). Never an identity.
  kind               TEXT NULL CHECK (kind IS NULL OR char_length(kind) <= 60),
  origin             TEXT NOT NULL CHECK (origin IN ('device_schedule', 'inventory', 'technician')),
  created_by         TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at         TIMESTAMPTZ NULL,
  client_request_id  UUID NOT NULL,
  CONSTRAINT notebook_components_request_uniq UNIQUE (tenant_id, client_request_id),
  -- Lets a selection prove its component belongs to the same notebook (composite FK below).
  CONSTRAINT notebook_components_id_notebook_uniq UNIQUE (id, notebook_id),
  CONSTRAINT notebook_components_notebook_fk
    FOREIGN KEY (notebook_id) REFERENCES equipment_notebooks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notebook_components_notebook
  ON notebook_components (tenant_id, notebook_id, position);

CREATE TABLE IF NOT EXISTS notebook_component_revisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  component_id       UUID NOT NULL,
  revision           INTEGER NOT NULL CHECK (revision >= 1),
  raw_label          TEXT NULL CHECK (raw_label IS NULL OR char_length(raw_label) <= 500),
  input_kind         TEXT NOT NULL CHECK (input_kind IN ('typed', 'photo', 'schedule', 'inventory')),
  manufacturer       TEXT NULL CHECK (manufacturer IS NULL OR char_length(manufacturer) <= 120),
  family             TEXT NULL CHECK (family IS NULL OR char_length(family) <= 120),
  catalog_number     TEXT NULL CHECK (catalog_number IS NULL OR char_length(catalog_number) <= 120),
  serial_number      TEXT NULL CHECK (serial_number IS NULL OR char_length(serial_number) <= 120),
  hardware_revision  TEXT NULL CHECK (hardware_revision IS NULL OR char_length(hardware_revision) <= 60),
  local_tag          TEXT NULL CHECK (local_tag IS NULL OR char_length(local_tag) <= 60),
  identity_status    TEXT NOT NULL CHECK (identity_status IN ('unknown', 'candidate', 'user_confirmed')),
  unresolved         JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unresolved) = 'array'),
  -- Where the values came from: a photo on this notebook, or a written note
  -- (device schedule line, inventory row). Never a model's paraphrase.
  evidence_file_id   UUID NULL,
  evidence_note      TEXT NULL CHECK (evidence_note IS NULL OR char_length(evidence_note) <= 1000),
  confirmed_by       TEXT NULL,
  confirmed_at       TIMESTAMPTZ NULL,
  created_by         TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_request_id  UUID NOT NULL,
  CONSTRAINT notebook_component_revisions_revision_uniq UNIQUE (component_id, revision),
  CONSTRAINT notebook_component_revisions_request_uniq UNIQUE (tenant_id, client_request_id),
  CONSTRAINT notebook_component_revisions_confirmed_chk
    CHECK ((identity_status = 'user_confirmed') = (confirmed_at IS NOT NULL)),
  CONSTRAINT notebook_component_revisions_component_fk
    FOREIGN KEY (component_id) REFERENCES notebook_components(id) ON DELETE CASCADE,
  CONSTRAINT notebook_component_revisions_evidence_fk
    FOREIGN KEY (evidence_file_id) REFERENCES namespace_direct_uploads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notebook_component_revisions_latest
  ON notebook_component_revisions (tenant_id, component_id, revision DESC);

CREATE TABLE IF NOT EXISTS notebook_thread_selections (
  tenant_id           UUID NOT NULL,
  notebook_id         UUID NOT NULL,
  owner_user_id       TEXT NOT NULL,
  thread_key          TEXT NOT NULL CHECK (thread_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  component_id        UUID NOT NULL,
  component_revision  INTEGER NOT NULL CHECK (component_revision >= 1),
  selected_via        TEXT NOT NULL CHECK (selected_via IN ('picker', 'return', 'clarify', 'confirm', 'correction')),
  selected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- The last client request that set this row; a retried request is a no-op.
  last_request_id     UUID NULL,
  PRIMARY KEY (tenant_id, notebook_id, owner_user_id, thread_key),
  CONSTRAINT notebook_thread_selections_notebook_fk
    FOREIGN KEY (notebook_id) REFERENCES equipment_notebooks(id) ON DELETE CASCADE,
  -- The selected component must be one of THIS notebook's components.
  CONSTRAINT notebook_thread_selections_component_fk
    FOREIGN KEY (component_id, notebook_id) REFERENCES notebook_components(id, notebook_id) ON DELETE CASCADE
);

ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS component_id UUID NULL;
ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS component_revision INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'equipment_notebook_turns_component_fk'
       AND conrelid = 'equipment_notebook_turns'::regclass
  ) THEN
    ALTER TABLE equipment_notebook_turns
      ADD CONSTRAINT equipment_notebook_turns_component_fk
      FOREIGN KEY (component_id) REFERENCES notebook_components(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_equipment_notebook_turns_component
  ON equipment_notebook_turns (tenant_id, notebook_id, component_id)
  WHERE component_id IS NOT NULL;

ALTER TABLE notebook_components          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebook_component_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebook_thread_selections   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notebook_components_tenant_isolation ON notebook_components;
CREATE POLICY notebook_components_tenant_isolation ON notebook_components
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

DROP POLICY IF EXISTS notebook_component_revisions_tenant_isolation ON notebook_component_revisions;
CREATE POLICY notebook_component_revisions_tenant_isolation ON notebook_component_revisions
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

DROP POLICY IF EXISTS notebook_thread_selections_tenant_isolation ON notebook_thread_selections;
CREATE POLICY notebook_thread_selections_tenant_isolation ON notebook_thread_selections
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- Components: rows are added and retired (UPDATE retired_at / position), never deleted by the app.
GRANT SELECT, INSERT, UPDATE ON notebook_components TO factorylm_app;
-- Revisions: append-only for the app role.
GRANT SELECT, INSERT ON notebook_component_revisions TO factorylm_app;
-- Selections: one mutable row per conversation.
GRANT SELECT, INSERT, UPDATE, DELETE ON notebook_thread_selections TO factorylm_app;

COMMENT ON TABLE notebook_components IS
  'Bench checklist: one row per physical component of a machine notebook. Stable id; identity lives in notebook_component_revisions.';
COMMENT ON TABLE notebook_component_revisions IS
  'Append-only identity revisions of a bench component. raw_label verbatim; unresolved fields stored NULL, never guessed.';
COMMENT ON TABLE notebook_thread_selections IS
  'The component one technician''s conversation is asking about. selected_at is the model-carry boundary.';
COMMENT ON COLUMN equipment_notebook_turns.component_id IS
  'Bench component the turn was asked under (115). Point-in-time; NULL = no component selected.';

COMMIT;

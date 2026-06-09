BEGIN;

-- Extensions this migration depends on (already created by 010/015 in the
-- ordered pipeline; IF NOT EXISTS keeps a standalone apply self-contained).
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Migration 046: `asset_agent_status` — per-asset agent lifecycle row.
--
-- Spec : docs/specs/asset-agent-validation-spec.md §6 (data model)
-- Rule : .claude/rules/train-before-deploy.md
--
-- Role:
--   One row per asset that has (or is building toward) a deployable agent.
--   Tracks the lifecycle `draft → training → validating → approved → deployed`
--   (+ `rejected` / `deprecated`) that gates when an asset's agent may answer
--   on a deployment surface (Ignition / HMI). The deployment gate (a later,
--   beta-gated phase behind ENFORCE_ASSET_AGENT_GATE) consults `state` here.
--
-- KEYING — `equipment_id` is `cmms_equipment.id`, the asset the Hub UI
--   (`/assets/[id]`, AssetChat, QR) operates on. Spec §6 named this
--   `kg_entity_id`, but the Hub asset surface is cmms_equipment-keyed and not
--   every asset has a kg_entities node, so the lifecycle row is keyed to the
--   asset the customer actually validates. `uns_path` (canonical UNS key, per
--   .claude/rules/uns-compliance.md) is carried so the future deployment gate
--   — which certifies direct connections by UNS path
--   (.claude/rules/direct-connection-uns-certified.md) — can bridge to it.
--   Soft link (no hard FK): kg_entities / installed_component_instances /
--   cmms_equipment lineage is dual — same pattern as wiring_connections (026)
--   and tag_events (033).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS asset_agent_status (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,

    -- The asset this agent is scoped to. = cmms_equipment.id. Soft link.
    equipment_id  UUID NOT NULL,

    -- Resolved UNS path of the asset, when known. The future deployment gate
    -- keys on this (canonical UNS-compliance key). Nullable: the asset may not
    -- have a resolved UNS path yet.
    uns_path      LTREE,

    -- The lifecycle state. CHECK so a bad transition surfaces at write time.
    state         TEXT NOT NULL DEFAULT 'draft'
        CHECK (state IN (
            'draft',       -- entity exists; agent not started
            'training',    -- docs/tags attaching; proposals flowing
            'validating',  -- grounded; validation Q&A in progress
            'approved',    -- human signed off (requires approved_by)
            'deployed',    -- live on a deployment surface
            'rejected',    -- validation failed / agent pulled
            'deprecated'   -- underlying asset/docs retired
        )),

    -- Promotion to 'approved' is ALWAYS a human action (spec §4 invariant).
    -- A row in 'approved'/'deployed' without approved_by is a bug.
    approved_by   TEXT,                  -- 'human:user_<uuid>'
    approved_at   TIMESTAMPTZ,
    deployed_at   TIMESTAMPTZ,
    deployed_by   TEXT,
    deploy_surface TEXT
        CHECK (deploy_surface IS NULL OR deploy_surface IN (
            'ignition', 'perspective', 'hub_display', 'qr'
        )),

    -- §5 acceptance signals the approve gate reads (persisted because the gate
    -- reads them; display-only counts like doc_count are derived in the API).
    citation_coverage INTEGER NOT NULL DEFAULT 0,  -- # validation Q with ≥1 citation
    min_groundedness  SMALLINT,                     -- lowest groundedness across counted answers
    last_validated_at TIMESTAMPTZ,

    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_agent_status_tenant_state
    ON asset_agent_status (tenant_id, state);

-- Future deployment gate looks up by UNS path.
CREATE INDEX IF NOT EXISTS idx_asset_agent_status_uns
    ON asset_agent_status USING GIST (tenant_id, uns_path)
    WHERE uns_path IS NOT NULL;

ALTER TABLE asset_agent_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_agent_status_tenant ON asset_agent_status;
CREATE POLICY asset_agent_status_tenant
    ON asset_agent_status
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE ON asset_agent_status TO factorylm_app;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────
-- DOWN
-- ────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS asset_agent_status_tenant ON asset_agent_status;
-- DROP TABLE IF EXISTS asset_agent_status;
-- COMMIT;

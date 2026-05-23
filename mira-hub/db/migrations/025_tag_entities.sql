BEGIN;

-- Migration 025: `tag_entities` — promote PLC / Sparkplug / OPC UA tags from
-- `kg_entities.properties` JSONB into a first-class typed table.
--
-- Spec : docs/specs/mira-ground-truth-architecture-investigation.md §5.3
-- ADR  : 0013 (Hub owns product-surface schema), 0014 (sibling work queue)
--
-- Why a dedicated table:
--
--   1. "Where is sensor X in the PLC?" must be answerable from structure,
--      not RAG. Today the answer lives in free-text properties on
--      `kg_entities` of `entity_type='tag'`.
--   2. Tags carry typed fields (data_type, units, scaling envelope, source
--      address) that don't survive a JSONB free-for-all. Renames silently
--      break joins.
--   3. The live nervous system (mira-relay, Ignition feed, Sparkplug B
--      MQTT) wants to look up `(tenant, sparkplug_topic)` and `(tenant,
--      source_address)` in a single index hit. JSONB GIN is too coarse.
--   4. Each tag points back at the component it belongs to so the engine
--      can answer "this current spike came from VFD G1's output" without
--      a relationship-traversal.
--
-- Source-of-truth note: writers MUST go through `ai_suggestions`
-- (migration 027) for LLM-derived rows. Direct INSERT is reserved for
-- structured imports (Ignition CSV, Rockwell L5X, GSDML, IODD) where
-- provenance is unambiguous.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS tag_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Authoritative address in the Unified Namespace tree. ltree column
    -- mirroring `kg_entities.uns_path` (migration 010). One tag per path
    -- per tenant.
    uns_path LTREE NOT NULL,

    -- Live-data identifiers — at least one of these must be non-null for
    -- a tag to be reachable by the relay / MCP query surface. Enforced at
    -- the writer, not as a DB CHECK, because some imports (e.g. a GSDML
    -- module-slot map) define the symbolic + source_address pair before
    -- the customer's Ignition project gives them a Sparkplug topic.
    sparkplug_topic TEXT,                       -- 'spBv1.0/orlando/DDATA/edge1/conveyor_b16/motor_current'
    opcua_node_id   TEXT,                       -- 'ns=2;s=Conveyor.Motor.Current' or numeric form
    symbolic_name   TEXT NOT NULL,              -- 'motor_current' — what the program/manual calls it

    -- IEC 61131 type system. App layer maps these to provider-specific
    -- types (Modbus REAL → IEEE-754 little-endian, etc.) on read.
    data_type TEXT NOT NULL
        CHECK (data_type IN ('BOOL', 'INT16', 'INT32', 'INT64',
                             'UINT16', 'UINT32', 'UINT64',
                             'REAL', 'LREAL', 'STRING', 'BYTES')),

    units   TEXT,                               -- 'rpm', 'A', 'V', '°C', 'psi', '0.1Hz', dimensionless = NULL
    scaling JSONB,                              -- {raw_min, raw_max, eng_min, eng_max, offset}

    -- How the value gets out of the device. The address format is the
    -- writer's responsibility — '%IX0.5' for IEC 61131, 'HR:101' for
    -- Modbus holding register, 'ns=2;s=...' for OPC UA, etc.
    source_kind TEXT NOT NULL
        CHECK (source_kind IN ('plc_address', 'modbus_register',
                               'sparkplug_metric', 'opcua_variable',
                               'mqtt_topic', 'manual_entry')),
    source_address TEXT NOT NULL,

    -- Soft FK; the deployment-side table is also tenant-scoped, so RLS
    -- already gates cross-rows. ON DELETE SET NULL preserves the tag row
    -- if the component instance is replaced (lifecycle column in 017).
    component_instance_id UUID
        REFERENCES installed_component_instances(id) ON DELETE SET NULL,

    -- Diagnostic envelope: the engine uses this to evaluate live values
    -- against expectation. Shape:
    --   { "min": 0, "max": 100, "normal_range": [10, 60],
    --     "fault_states": [{ "code": "F0007", "trigger": ">95" }] }
    expected_envelope JSONB,

    -- Same approval lifecycle as kg_relationships (docs/migrations/008).
    -- LLM-extracted tags land 'proposed'; structured imports may land
    -- 'verified' if the source is admin-signed.
    approval_state TEXT NOT NULL DEFAULT 'proposed'
        CHECK (approval_state IN ('proposed', 'verified', 'rejected', 'needs_review')),
    proposed_by      TEXT,                      -- 'llm:groq', 'human:user_xxx', 'rule:ignition_csv', 'import:l5x'
    evidence_summary JSONB,                     -- short snapshot — full chain on ai_suggestions (mig 027)

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, uns_path)
);

-- Path traversal: GIST on the ltree column for "all tags under <line>".
CREATE INDEX IF NOT EXISTS idx_tag_entities_uns_path_gist
    ON tag_entities USING GIST (uns_path);

-- Reverse lookups the relay and the engine hit on every live event.
CREATE INDEX IF NOT EXISTS idx_tag_entities_source_address
    ON tag_entities (tenant_id, source_address);
CREATE INDEX IF NOT EXISTS idx_tag_entities_sparkplug_topic
    ON tag_entities (tenant_id, sparkplug_topic)
    WHERE sparkplug_topic IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tag_entities_component
    ON tag_entities (tenant_id, component_instance_id)
    WHERE component_instance_id IS NOT NULL;

-- Proposal-feed partial index — Hub `/proposals?type=tag_mapping` reads here.
CREATE INDEX IF NOT EXISTS idx_tag_entities_pending
    ON tag_entities (tenant_id, created_at DESC)
    WHERE approval_state = 'proposed';

ALTER TABLE tag_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tag_entities_tenant ON tag_entities;
CREATE POLICY tag_entities_tenant
    ON tag_entities
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE ON tag_entities TO factorylm_app;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS tag_entities_tenant ON tag_entities;
-- DROP TABLE IF EXISTS tag_entities;
-- COMMIT;

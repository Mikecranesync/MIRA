BEGIN;

-- Component Intelligence — Installed Instances (Layer 2).
-- Spec: docs/specs/mira-component-intelligence-architecture.md
--
-- One row per physical component deployed at a tenant site. Binds a template
-- (the "what is this") to a specific location, panel, wire, and PLC tag (the
-- "where is it and how is it connected"). Tenant-scoped with RLS — every read
-- requires app.current_tenant_id to match.

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS installed_component_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Bind to a catalog template (the "what is this")
    template_id UUID REFERENCES component_templates(id) ON DELETE SET NULL,

    -- Bind to a CMMS asset (the parent equipment this component lives in).
    -- NOT a hard FK because cmms_equipment may live in a different schema/db
    -- in some deployments. Validated at the application layer.
    asset_id UUID,

    -- Name resolution — the same physical sensor is often called 3-4 different
    -- things across drawings, PLC code, and operator chatter. canonical_name
    -- is what we display; aliases is everything we'll match on.
    component_name TEXT NOT NULL,
    canonical_name TEXT,
    aliases TEXT[] NOT NULL DEFAULT '{}',

    -- Physical placement
    installed_location TEXT,
    panel TEXT,
    terminal TEXT,
    wire_number TEXT,

    -- Live-data binding
    plc_tag TEXT,
    mqtt_topic TEXT,

    -- ISA-95 / UNS address (full path including this component)
    uns_path ltree,

    -- Trust signal — distinguishes "we extracted this from an LLM and nobody
    -- has confirmed it" from "the maintenance lead signed off in person".
    human_confirmed BOOLEAN NOT NULL DEFAULT false,
    confidence FLOAT NOT NULL DEFAULT 0.5
        CHECK (confidence >= 0.0 AND confidence <= 1.0),

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installed_instances_tenant
    ON installed_component_instances (tenant_id);
CREATE INDEX IF NOT EXISTS idx_installed_instances_asset
    ON installed_component_instances (asset_id);
CREATE INDEX IF NOT EXISTS idx_installed_instances_template
    ON installed_component_instances (template_id);
CREATE INDEX IF NOT EXISTS idx_installed_instances_uns
    ON installed_component_instances USING GIST (uns_path);
CREATE INDEX IF NOT EXISTS idx_installed_instances_tenant_uns
    ON installed_component_instances USING GIST (tenant_id, uns_path);
CREATE INDEX IF NOT EXISTS idx_installed_instances_plc_tag
    ON installed_component_instances (tenant_id, plc_tag)
    WHERE plc_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_installed_instances_aliases
    ON installed_component_instances USING GIN (aliases);

-- Tenant isolation
ALTER TABLE installed_component_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installed_instances_tenant ON installed_component_instances;
CREATE POLICY installed_instances_tenant
    ON installed_component_instances
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

COMMIT;

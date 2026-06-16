BEGIN;

-- Component Intelligence — Templates (Layer 1).
-- Spec: docs/specs/mira-component-intelligence-architecture.md
--
-- Templates are the canonical, shared description of a component family/model
-- (e.g. "AutomationDirect GS10 VFD"). They are NOT tenant-scoped — the catalog
-- is shared across all customers. Tenant-specific deployment lives in
-- installed_component_instances (migration 017).
--
-- JSONB is used for every field whose shape varies by component category
-- (sensors vs. drives vs. PLCs have very different specs). The structured
-- columns (manufacturer, model, category, type) are the queryable filter axis.

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS component_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    component_category TEXT NOT NULL,
    component_type TEXT NOT NULL,
    manufacturer TEXT,
    model TEXT,
    description TEXT,

    -- Electrical / mechanical / I/O specs (shape varies by category)
    power_specs JSONB NOT NULL DEFAULT '{}',
    input_output_specs JSONB NOT NULL DEFAULT '{}',
    signal_behavior JSONB NOT NULL DEFAULT '{}',
    connector_type TEXT,
    pinout JSONB NOT NULL DEFAULT '{}',
    environmental_limits JSONB NOT NULL DEFAULT '{}',
    mounting_notes TEXT,

    -- Diagnostics & maintenance knowledge
    diagnostic_indicators JSONB NOT NULL DEFAULT '[]',
    expected_signals JSONB NOT NULL DEFAULT '[]',
    common_failure_modes JSONB NOT NULL DEFAULT '[]',
    troubleshooting_steps JSONB NOT NULL DEFAULT '[]',
    pm_checks JSONB NOT NULL DEFAULT '[]',
    safety_notes JSONB NOT NULL DEFAULT '[]',

    -- ISA-95 / UNS placement
    recommended_uns_template TEXT,
    uns_path ltree,

    -- Provenance
    verification_status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (verification_status IN ('proposed', 'verified', 'rejected')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One canonical row per manufacturer+model+version. NULLs are distinct in
    -- PostgreSQL, so unbranded templates can coexist; the (mfr, model) index
    -- handles the branded lookups.
    UNIQUE (manufacturer, model, version)
);

-- Source provenance — every template should trace back to at least one document.
CREATE TABLE IF NOT EXISTS component_template_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES component_templates(id) ON DELETE CASCADE,

    source_type TEXT NOT NULL
        CHECK (source_type IN ('manual', 'datasheet', 'print', 'technician_note', 'oem_kb', 'other')),
    source_document_id UUID,        -- FK into knowledge_entries / documents when available
    source_url TEXT,
    page_numbers TEXT,              -- free-form: "12", "12-15,22", "Appendix A"
    excerpt TEXT,                   -- short quote that grounded the extraction

    extraction_confidence FLOAT NOT NULL DEFAULT 0.5
        CHECK (extraction_confidence >= 0.0 AND extraction_confidence <= 1.0),
    extracted_by TEXT NOT NULL DEFAULT 'llm'
        CHECK (extracted_by IN ('llm', 'human', 'import', 'rule')),
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_component_templates_mfr_model
    ON component_templates (manufacturer, model);
CREATE INDEX IF NOT EXISTS idx_component_templates_category
    ON component_templates (component_category);
CREATE INDEX IF NOT EXISTS idx_component_templates_type
    ON component_templates (component_type);
CREATE INDEX IF NOT EXISTS idx_component_templates_status
    ON component_templates (verification_status);
CREATE INDEX IF NOT EXISTS idx_component_templates_uns
    ON component_templates USING GIST (uns_path);

CREATE INDEX IF NOT EXISTS idx_template_sources_template
    ON component_template_sources (template_id);
CREATE INDEX IF NOT EXISTS idx_template_sources_doc
    ON component_template_sources (source_document_id);

COMMIT;

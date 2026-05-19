BEGIN;

-- Migration 026: `wiring_connections` — promote wire-level connectivity from
-- `kg_relationships.properties` JSONB to a first-class typed table.
--
-- Spec : docs/specs/mira-ground-truth-architecture-investigation.md §5.3
-- ADR  : 0013 (Hub owns product-surface schema)
--
-- Why a dedicated table:
--
--   1. "Where is PE-001 wired?" must be answerable from structure. Today
--      the answer lives in `kg_relationships.properties` JSONB on edges of
--      type 'WIRED_TO', which means traversing every WIRED_TO edge from a
--      panel and grepping JSONB to find a terminal. That's not what an
--      RLS-aware index can do.
--   2. Wiring carries typed fields (source/dest terminal, wire number,
--      gauge, color, function class) that the EPLAN / AutomationML
--      industrial-data-exchange model gives us for free. Free-text
--      JSONB loses the structure.
--   3. Drawing-reference traceability (every connection cites the sheet
--      and line on the print) is a compliance asset. Today there's no
--      first-class place for it.
--   4. `kg_relationships` keeps the WIRED_TO summary edge for graph
--      traversal — engine reasoning treats it as a coarse "these two
--      devices are connected" signal. The wire-level metadata lives here.
--
-- Source-of-truth note: writers MUST go through `ai_suggestions`
-- (migration 027) for LLM-derived rows. Direct INSERT is reserved for
-- structured imports (EPLAN AML, customer-confirmed schematic upload).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS wiring_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Endpoints. Both are kg_entities of `entity_type IN ('component_instance',
    -- 'terminal', 'panel', 'asset')`. Soft FKs because kg_entities is the
    -- dual-lineage table (ADR-0013 §3.2 #7); the hard FK would force a
    -- decision on which lineage's row is authoritative for a given id. The
    -- writers go through ai_suggestions, so soft FK is enough.
    source_entity_id UUID NOT NULL,
    source_terminal  TEXT NOT NULL,             -- 'X1:3', 'TB2-14', 'COIL:6', '24V+'

    dest_entity_id   UUID NOT NULL,
    dest_terminal    TEXT NOT NULL,

    -- Drawing-side identifiers. wire_number is what the print stamps on
    -- the conductor ('W-1147', '101A', 'L1'). cable_id groups conductors
    -- that share a jacket (used on multi-conductor cable like 8-pin DSUB
    -- or M12 connectors).
    wire_number TEXT,
    cable_id    TEXT,

    -- Physical attributes — relevant for current carrying capacity and
    -- safety calls. Optional; many wires on a control print don't have
    -- gauge called out.
    gauge_awg INTEGER,
    color     TEXT,                             -- 'BLK', 'RED', 'BU/YE', vendor-specific

    -- Semantic class — drives RAG retrieval and safety flagging. Power
    -- and safety connections get higher-confidence audit treatment.
    function_class TEXT
        CHECK (function_class IS NULL OR function_class IN (
            'power', 'signal', 'safety', 'comm', 'ground', 'unknown'
        )),

    -- Provenance back to the print. Format is opaque text — readers can
    -- be 'ENG-PL-4472, Sheet 12, Line 24' or 'doc:0a1f...page:8' for a
    -- KB document chunk.
    drawing_reference TEXT,

    -- Approval lifecycle. LLM-extracted connections (photo of a schematic,
    -- OCR of a print, technician verbal description) land 'proposed'.
    -- An EPLAN AML import from an admin-signed source may land 'verified'.
    approval_state TEXT NOT NULL DEFAULT 'proposed'
        CHECK (approval_state IN ('proposed', 'verified', 'rejected', 'needs_review')),
    proposed_by      TEXT,                      -- 'llm:groq', 'human:user_xxx', 'import:eplan', 'rule:bom'
    evidence_summary JSONB,                     -- short snapshot; full chain on ai_suggestions

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reverse-lookups: the two questions this table exists to answer fast.
CREATE INDEX IF NOT EXISTS idx_wiring_connections_source
    ON wiring_connections (tenant_id, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_wiring_connections_dest
    ON wiring_connections (tenant_id, dest_entity_id);

-- "Find the conductor by its stamped number on the print."
CREATE INDEX IF NOT EXISTS idx_wiring_connections_wire_number
    ON wiring_connections (tenant_id, wire_number)
    WHERE wire_number IS NOT NULL;

-- "All connections in this multi-conductor cable."
CREATE INDEX IF NOT EXISTS idx_wiring_connections_cable
    ON wiring_connections (tenant_id, cable_id)
    WHERE cable_id IS NOT NULL;

-- Proposal-feed partial index — Hub `/proposals?type=kg_edge` will join here
-- when the underlying suggestion has function_class='safety'/'power'.
CREATE INDEX IF NOT EXISTS idx_wiring_connections_pending
    ON wiring_connections (tenant_id, created_at DESC)
    WHERE approval_state = 'proposed';

ALTER TABLE wiring_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiring_connections_tenant ON wiring_connections;
CREATE POLICY wiring_connections_tenant
    ON wiring_connections
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE ON wiring_connections TO factorylm_app;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS wiring_connections_tenant ON wiring_connections;
-- DROP TABLE IF EXISTS wiring_connections;
-- COMMIT;

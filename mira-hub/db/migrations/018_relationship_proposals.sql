BEGIN;

-- Component Intelligence — Relationship Proposals + Evidence (Layer 3).
-- Spec: docs/specs/mira-component-intelligence-architecture.md
--
-- The proposal layer is upstream of kg_relationships. Every edge in the
-- knowledge graph starts here with confidence, status, and evidence. Nothing
-- lands in kg_relationships until verified (by a human or a high-confidence
-- rule). This protects the diagnostic engine from LLM-hallucinated wiring
-- claims while still letting us harvest the LLM's pattern-matching at scale.
--
-- Controlled vocabulary on relationship_type — keep this list in sync with
-- docs/specs/mira-component-intelligence-architecture.md §"Controlled vocabulary".

CREATE TABLE IF NOT EXISTS relationship_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,                 -- nullable: catalog-level proposals (template ↔ template) are tenant-agnostic

    source_entity_id UUID NOT NULL,
    source_entity_type TEXT NOT NULL,
    target_entity_id UUID NOT NULL,
    target_entity_type TEXT NOT NULL,

    relationship_type TEXT NOT NULL CHECK (relationship_type IN (
        -- Hierarchy
        'HAS_COMPONENT', 'INSTANCE_OF', 'LOCATED_IN', 'HAS_PART',
        -- Documentation
        'HAS_DOCUMENT', 'HAS_CHUNK', 'REFERENCES', 'HAS_PROCEDURE',
        -- Wiring & power
        'WIRED_TO', 'POWERED_BY', 'MAPS_TO', 'PUBLISHED_AS',
        -- Logic & control
        'USED_IN_LOGIC', 'TRIGGERS', 'CAUSES',
        -- Faults & resolution
        'OCCURS_ON', 'RESOLVED_BY', 'HAS_FAILURE_MODE',
        -- Signals
        'HAS_SIGNAL', 'HAS_ALIAS',
        -- Topology
        'DEPENDS_ON', 'UPSTREAM_OF', 'DOWNSTREAM_OF', 'REPLACES',
        -- Evidence meta
        'CONFIRMED_BY', 'CONTRADICTED_BY'
    )),

    confidence FLOAT NOT NULL DEFAULT 0.5
        CHECK (confidence >= 0.0 AND confidence <= 1.0),

    status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'reviewed', 'verified', 'rejected', 'deprecated', 'contradicted')),

    created_by TEXT NOT NULL DEFAULT 'llm'
        CHECK (created_by IN ('llm', 'human', 'import', 'rule')),

    risk_level TEXT NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low', 'medium', 'high', 'safety_critical')),
    requires_human_review BOOLEAN NOT NULL DEFAULT false,

    reasoning TEXT,                 -- LLM rationale or human comment
    version INTEGER NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,

    -- A self-edge would be a data bug. Catch it at the schema.
    CONSTRAINT no_self_loop CHECK (source_entity_id <> target_entity_id)
);

-- 1..N evidence per proposal. Without at least one row here, a proposal cannot
-- be promoted past 'proposed' (enforced at the application layer, not in the DB —
-- a CHECK would prevent inserting the proposal first, evidence second).
CREATE TABLE IF NOT EXISTS relationship_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES relationship_proposals(id) ON DELETE CASCADE,

    evidence_type TEXT NOT NULL CHECK (evidence_type IN (
        'document_page', 'plc_rung', 'tag_list', 'work_order',
        'technician_note', 'live_data', 'manifest', 'oem_kb', 'human_observation'
    )),
    source_id UUID,                 -- FK depends on evidence_type — validated at app layer
    source_description TEXT,
    page_or_location TEXT,          -- "page 42", "Rung 12", "HR:104", etc.
    excerpt TEXT,                   -- short quote that grounded the claim

    confidence_contribution FLOAT NOT NULL DEFAULT 0.0
        CHECK (confidence_contribution >= -1.0 AND confidence_contribution <= 1.0),
    -- Negative contribution = this evidence contradicts the proposal.

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rel_proposals_source
    ON relationship_proposals (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_proposals_target
    ON relationship_proposals (target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_proposals_type
    ON relationship_proposals (relationship_type);
CREATE INDEX IF NOT EXISTS idx_rel_proposals_status
    ON relationship_proposals (status);
CREATE INDEX IF NOT EXISTS idx_rel_proposals_review_queue
    ON relationship_proposals (status, requires_human_review, risk_level)
    WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_rel_proposals_tenant
    ON relationship_proposals (tenant_id)
    WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rel_evidence_proposal
    ON relationship_evidence (proposal_id);
CREATE INDEX IF NOT EXISTS idx_rel_evidence_type
    ON relationship_evidence (evidence_type);

-- Tenant isolation — RLS on the proposal table. Evidence inherits via cascade.
ALTER TABLE relationship_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rel_proposals_tenant ON relationship_proposals;
CREATE POLICY rel_proposals_tenant
    ON relationship_proposals
    USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id', true)::UUID
    );

ALTER TABLE relationship_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rel_evidence_tenant ON relationship_evidence;
CREATE POLICY rel_evidence_tenant
    ON relationship_evidence
    USING (
        proposal_id IN (
            SELECT id FROM relationship_proposals
            WHERE tenant_id IS NULL
               OR tenant_id = current_setting('app.current_tenant_id', true)::UUID
        )
    );

COMMIT;

BEGIN;

-- Migration 027: `ai_suggestions` — broad Hub-facing work queue.
--
-- Spec : docs/specs/maintenance-namespace-builder-spec.md §"Data Model"
-- Spec : docs/specs/mira-ground-truth-architecture-investigation.md §3.1 #2, §5.3
-- ADR  : docs/adr/0014-ai-suggestions-as-broad-work-queue.md
--        (supersedes ADR-0013 §Decision item 1 — see ADR-0014 for the
--         rationale. tl;dr: relationship_proposals is edge-only; the Hub
--         /proposals page must also render kg_entity / tag_mapping /
--         component_profile / uns_confirmation / namespace_move suggestions,
--         none of which fit the edge schema.)
--
-- Role:
--   - One row per Hub-facing pending decision, regardless of shape.
--   - For `suggestion_type='kg_edge'`, the row is a header on top of a
--     `relationship_proposals` row (FK in payload). The detailed edge +
--     evidence chain still lives in mig 018; this row is what the Hub
--     `/proposals` list query reads.
--   - For all other suggestion types, this is the canonical store.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS ai_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- The six product-spec shapes. Tightened to a CHECK so a typo in a
    -- writer surfaces at INSERT time, not at Hub render time.
    suggestion_type TEXT NOT NULL
        CHECK (suggestion_type IN (
            'kg_edge',           -- header on a relationship_proposals row
            'kg_entity',         -- new entity (component instance, tag, location, asset)
            'tag_mapping',       -- a tag_entities row proposed by ingestion
            'component_profile', -- a component_templates row proposed by extraction
            'uns_confirmation',  -- the UNS Gate's "is this the right asset?" prompt
            'namespace_move'     -- a drag-drop / rename operation on the namespace tree
        )),

    -- Provenance — where the suggestion came from. Soft polymorphic FK;
    -- source_kind tells the reader which table source_id refers to.
    source_kind TEXT
        CHECK (source_kind IS NULL OR source_kind IN (
            'knowledge_entry',   -- a chunk from a PDF / manual
            'work_order',
            'tag_entity',
            'photo',             -- a row in equipment_photos / S3 blob
            'session',           -- a troubleshooting_sessions turn
            'manifest_row',      -- a row from research/variable-manifest.json
            'technician_note',
            'live_event',        -- a row in live_signal_events
            'manual_entry'       -- a human typed it in the Hub UI
        )),
    source_document_id UUID,                    -- knowledge_entries.id when source_kind='knowledge_entry'
    source_page INTEGER,                        -- 1-indexed page number; NULL for non-doc sources
    source_id UUID,                             -- polymorphic per source_kind; NULL when source_kind='manual_entry'

    -- The actual proposed change. Shape depends on suggestion_type:
    --
    --   kg_edge:           { "relationship_proposal_id": <uuid>,
    --                        "relationship_type": "WIRED_TO", ... }
    --   kg_entity:         { "entity_type": "component_instance",
    --                        "uns_path": "...", "properties": {...},
    --                        "template_id": <uuid|null> }
    --   tag_mapping:       { "tag_entity_id": <uuid>, ... }
    --   component_profile: { "manufacturer": "...", "model": "...",
    --                        "version": "...", ... }
    --   uns_confirmation:  { "candidate_paths": [...], "session_id": <uuid> }
    --   namespace_move:    { "from_path": "...", "to_path": "...",
    --                        "operation": "move"|"rename"|"merge"|"split" }
    --
    -- Schema-on-read; the reader is the Hub UI which already discriminates
    -- on suggestion_type.
    extracted_data JSONB NOT NULL DEFAULT '{}'::JSONB,

    -- 0.0 - 1.0. The writer is responsible for honest calibration; the
    -- Hub UI uses bands (low <0.5, medium 0.5-0.8, high >0.8) for sort
    -- and visual treatment.
    confidence FLOAT NOT NULL DEFAULT 0.5
        CHECK (confidence >= 0.0 AND confidence <= 1.0),

    -- Lifecycle. `pending` is the inbox; `accepted` and `rejected` are
    -- terminal. `deferred` is "ask me later" — the Hub UI surfaces these
    -- in a separate tab. `superseded` is set automatically when a newer
    -- suggestion contradicts this one (writer responsibility).
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'deferred', 'superseded')),

    -- Risk tier — drives required-review gating in the Hub UI. Safety
    -- proposals (anything touching E-stop, interlock, LOTO, ground-fault)
    -- MUST be flagged 'safety_critical' by the writer.
    risk_level TEXT NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low', 'medium', 'high', 'safety_critical')),

    -- Who proposed it, who reviewed it. Free-text actor ids — same
    -- vocabulary as `relationship_proposals.proposed_by`:
    --   'llm:groq' | 'llm:cerebras' | 'llm:gemini'
    --   'human:user_<uuid>'
    --   'rule:<rule_name>' | 'import:<format>'
    proposed_by TEXT NOT NULL DEFAULT 'llm:unknown',
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,                           -- free-text rationale on accept/reject

    -- Short human-readable headline + body. Computed by the writer at
    -- INSERT time so the Hub feed renders fast (no per-row LLM call).
    title TEXT,                                 -- 'Propose AutomationDirect GS10 at Line B / Conveyor 16'
    body  TEXT,                                 -- one-paragraph context

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hub `/proposals` list query — pending first, newest first, by type.
-- Partial index keeps the hot path small even as the table accumulates.
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_pending
    ON ai_suggestions (tenant_id, suggestion_type, created_at DESC)
    WHERE status = 'pending';

-- Risk-first triage view — surfaced in the Hub feed for safety_critical.
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_risk
    ON ai_suggestions (tenant_id, risk_level, created_at DESC)
    WHERE status = 'pending' AND risk_level IN ('high', 'safety_critical');

-- "Show me all proposals from this document" — review by source.
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_source_doc
    ON ai_suggestions (tenant_id, source_document_id)
    WHERE source_document_id IS NOT NULL;

-- Audit / history view — what did this reviewer decide?
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_reviewer
    ON ai_suggestions (tenant_id, reviewed_by, reviewed_at DESC)
    WHERE reviewed_by IS NOT NULL;

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_suggestions_tenant ON ai_suggestions;
CREATE POLICY ai_suggestions_tenant
    ON ai_suggestions
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE ON ai_suggestions TO factorylm_app;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS ai_suggestions_tenant ON ai_suggestions;
-- DROP TABLE IF EXISTS ai_suggestions;
-- COMMIT;

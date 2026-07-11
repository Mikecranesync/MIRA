BEGIN;

-- Migration 063: visual_session spine — MIRA Visual Technician (ADR-0027, Phase 1).
--
-- WHAT THIS IS
--   The persistent, multi-image, cross-surface evidence session that the PRD's
--   north star requires and that does not exist today (a session held ONE photo,
--   replaced not accumulated). Six tables:
--     visual_session   — one evolving session (multi-image, machine-associable).
--     evidence_item    — one uploaded image/doc + its preserved original + hash.
--     region_of_interest — a crop/region on an evidence item (user or system).
--     observation      — the atomic-claim LEDGER (append-only + review history).
--     visual_question  — one Q&A turn (question + composed answer envelope).
--     answer_claim     — one claim inside an answer, with its evidence_state.
--
--   entity/connection CANDIDATES are NOT new tables — they REUSE kg_entities
--   (proposed) and wiring_connections (proposed, via the WiringRow seam).
--   pack revisions REUSE the Print Pack pack_model.json. verification_task is
--   deferred to Phase 3 (the reviewer workflow), not created here.
--
-- EVIDENCE STATE (ADR-0027 D2) — a VIEW over existing vocabularies, not a new
--   one: VISIBLE / DOCUMENTED / MACHINE_VERIFIED / LIKELY / NEEDS_CONTEXT /
--   CONFLICTING / FIELD_VERIFICATION_REQUIRED / REJECTED / SUPERSEDED. Shipped
--   once here as a SQL CHECK and mirrored by mira-bots/shared/visual/evidence_state.py.
--
-- APPEND-ONLY WITH NARROW EXCEPTIONS (same doctrine as mig 037/038):
--     observation   : INSERT + narrow UPDATE (review_state, superseded_by,
--                     normalized_value on correction). No DELETE.
--     answer_claim  : INSERT only (an answer is immutable once composed). No UPDATE/DELETE.
--     visual_question: INSERT only. No UPDATE/DELETE.
--     visual_session/evidence_item/region: INSERT + UPDATE (session status,
--                     evidence derived_*, quality_score). No DELETE.
--
-- TENANT ISOLATION — UUID-family RLS, dual-setting form (app.tenant_id OR
--   app.current_tenant_id), matching mig 033/037/038 and the engine writer
--   (mira-bots/shared decision_trace.py sets app.current_tenant_id). This is the
--   PRD hard rule "no anonymous cross-tenant retrieval," enforced in-DB and
--   TESTED (tests/test_visual_session_migration.py, ephemeral postgres).

CREATE EXTENSION IF NOT EXISTS ltree;

-- ─── visual_session ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visual_session (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Optional machine association (soft link; no hard FK, same pattern as
    -- tag_events.equipment_entity_id). NULL for an unassigned session.
    asset_id UUID,
    uns_path LTREE,

    title TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'published', 'archived')),

    -- Set when a pack revision is published from this session (Phase 4).
    current_revision UUID,

    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS visual_session_tenant_time_idx
    ON visual_session (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS visual_session_asset_idx
    ON visual_session (tenant_id, asset_id);

ALTER TABLE visual_session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visual_session_tenant ON visual_session;
CREATE POLICY visual_session_tenant ON visual_session
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON visual_session TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON visual_session FROM PUBLIC;

-- ─── evidence_item ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evidence_item (
    evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    tenant_id UUID NOT NULL,

    source_type TEXT NOT NULL DEFAULT 'unknown'
        CHECK (source_type IN ('print','panel','component','nameplate','terminal',
                               'plc','drive','hmi','area','mixed','unknown')),
    drawing_type TEXT,   -- ladder|one_line|pid|wiring|panel|unknown (nullable)

    -- Source preservation (FR-1): original ALWAYS retained; derived is the
    -- corrected/cropped derivative. Hash is the content hash for dedup/audit.
    original_uri TEXT,
    original_hash TEXT,
    derived_uri TEXT,
    derived_hash TEXT,
    capture_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Image-quality gate (FR-3): 0.0..1.0; NULL if not yet scored.
    quality_score NUMERIC,
    page_ref TEXT,       -- page/sheet association (nullable)

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS evidence_item_session_idx
    ON evidence_item (session_id, created_at);
CREATE INDEX IF NOT EXISTS evidence_item_tenant_idx
    ON evidence_item (tenant_id, created_at DESC);

ALTER TABLE evidence_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_item_tenant ON evidence_item;
CREATE POLICY evidence_item_tenant ON evidence_item
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON evidence_item TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON evidence_item FROM PUBLIC;

-- ─── region_of_interest ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS region_of_interest (
    region_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id UUID NOT NULL,
    tenant_id UUID NOT NULL,

    geometry JSONB NOT NULL,          -- {type:'bbox', x,y,w,h} or polygon
    label TEXT,
    origin TEXT NOT NULL DEFAULT 'system'
        CHECK (origin IN ('user', 'system')),
    transform_to_original JSONB,      -- maps derived-crop coords back to original

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS region_of_interest_evidence_idx
    ON region_of_interest (evidence_id);

ALTER TABLE region_of_interest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS region_of_interest_tenant ON region_of_interest;
CREATE POLICY region_of_interest_tenant ON region_of_interest
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON region_of_interest TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON region_of_interest FROM PUBLIC;

-- ─── observation (the ledger) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS observation (
    observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    evidence_id UUID,                 -- nullable (some observations span items)
    region_id UUID,                   -- nullable

    obs_kind TEXT NOT NULL
        CHECK (obs_kind IN ('entity', 'property', 'relation')),
    raw_value TEXT,                   -- as read from the image/OCR
    normalized_value TEXT,            -- canonicalized (may be corrected on review)

    -- The evidence-state VIEW (ADR-0027 D2). Mirror of EvidenceState (Python).
    evidence_state TEXT NOT NULL
        CHECK (evidence_state IN ('VISIBLE','DOCUMENTED','MACHINE_VERIFIED','LIKELY',
                                  'NEEDS_CONTEXT','CONFLICTING','FIELD_VERIFICATION_REQUIRED',
                                  'REJECTED','SUPERSEDED')),
    confidence NUMERIC,               -- 0.0..1.0 (nullable)
    extractor TEXT,                   -- vision_worker|print_worker|schematic_intelligence|ocr|technician

    review_state TEXT NOT NULL DEFAULT 'unreviewed'
        CHECK (review_state IN ('unreviewed','confirmed','corrected','rejected')),
    superseded_by UUID,               -- append-only history: points at the newer observation

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS observation_session_idx
    ON observation (session_id, created_at);
CREATE INDEX IF NOT EXISTS observation_evidence_idx
    ON observation (evidence_id);
CREATE INDEX IF NOT EXISTS observation_state_idx
    ON observation (session_id, evidence_state);

ALTER TABLE observation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS observation_tenant ON observation;
CREATE POLICY observation_tenant ON observation
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);
-- Append + narrow UPDATE (review_state / superseded_by / normalized_value). No DELETE.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON observation TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON observation FROM PUBLIC;

-- ─── visual_question (one Q&A turn) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visual_question (
    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    tenant_id UUID NOT NULL,

    text TEXT NOT NULL,               -- the technician's question
    answer TEXT,                      -- the composed plain-English answer
    next_best_evidence TEXT,          -- the single most useful next photo/sheet
    safety_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
    asked_by TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS visual_question_session_idx
    ON visual_question (session_id, created_at);

ALTER TABLE visual_question ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visual_question_tenant ON visual_question;
CREATE POLICY visual_question_tenant ON visual_question
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT ON visual_question TO factorylm_app;
    END IF;
END $$;
REVOKE UPDATE, DELETE ON visual_question FROM PUBLIC;

-- ─── answer_claim ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS answer_claim (
    claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL,
    session_id UUID NOT NULL,
    tenant_id UUID NOT NULL,

    text TEXT NOT NULL,               -- the claim itself
    claim_type TEXT,
    evidence_state TEXT NOT NULL
        CHECK (evidence_state IN ('VISIBLE','DOCUMENTED','MACHINE_VERIFIED','LIKELY',
                                  'NEEDS_CONTEXT','CONFLICTING','FIELD_VERIFICATION_REQUIRED',
                                  'REJECTED','SUPERSEDED')),
    supporting_observation_ids UUID[] NOT NULL DEFAULT '{}',
    doc_citations JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{doc, locator}] manual citations
    uncertainty TEXT,
    safety_flag BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS answer_claim_question_idx
    ON answer_claim (question_id);
CREATE INDEX IF NOT EXISTS answer_claim_session_idx
    ON answer_claim (session_id, created_at);

ALTER TABLE answer_claim ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS answer_claim_tenant ON answer_claim;
CREATE POLICY answer_claim_tenant ON answer_claim
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT ON answer_claim TO factorylm_app;
    END IF;
END $$;
REVOKE UPDATE, DELETE ON answer_claim FROM PUBLIC;

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS answer_claim_tenant ON answer_claim;
-- DROP POLICY IF EXISTS visual_question_tenant ON visual_question;
-- DROP POLICY IF EXISTS observation_tenant ON observation;
-- DROP POLICY IF EXISTS region_of_interest_tenant ON region_of_interest;
-- DROP POLICY IF EXISTS evidence_item_tenant ON evidence_item;
-- DROP POLICY IF EXISTS visual_session_tenant ON visual_session;
-- DROP TABLE IF EXISTS answer_claim;
-- DROP TABLE IF EXISTS visual_question;
-- DROP TABLE IF EXISTS observation;
-- DROP TABLE IF EXISTS region_of_interest;
-- DROP TABLE IF EXISTS evidence_item;
-- DROP TABLE IF EXISTS visual_session;
-- COMMIT;

BEGIN;

-- Migration 047: `asset_validation_qa` — the validation transcript an approver
-- signs off on, per asset.
--
-- Spec : docs/specs/asset-agent-validation-spec.md §6 (data model)
-- Rule : .claude/rules/train-before-deploy.md
--
-- Role:
--   One row per validation question asked against an asset's agent during the
--   `validating` phase. The human reviewer marks each `reviewer_verdict`
--   (good / bad / needs_review; NULL = not yet reviewed). The §5 approve gate
--   counts rows where verdict='good' AND a citation resolves to a
--   knowledge_entries chunk in the asset's UNS subtree.
--
-- KEYING — `equipment_id` is `cmms_equipment.id`, matching asset_agent_status
--   (046). Soft link (dual lineage; no hard FK).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS asset_validation_qa (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    equipment_id  UUID NOT NULL,            -- = cmms_equipment.id (the asset)

    question        TEXT NOT NULL,
    expected_answer TEXT,                   -- optional reviewer-provided ground truth
    mira_answer     TEXT,

    -- [{doc_id, page, source_url}] — the citations the answer resolved to.
    citations       JSONB NOT NULL DEFAULT '[]'::JSONB,

    groundedness         SMALLINT,          -- engine 1–5, copied from the turn
    evidence_utilization REAL,              -- from benchmark_db

    reviewer_verdict TEXT
        CHECK (reviewer_verdict IS NULL
               OR reviewer_verdict IN ('good', 'bad', 'needs_review')),
    reviewed_by      TEXT,
    reviewed_at      TIMESTAMPTZ,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- All validation Q&A for one asset, newest first (Validate tab + approve gate).
CREATE INDEX IF NOT EXISTS idx_asset_validation_qa_equipment
    ON asset_validation_qa (tenant_id, equipment_id, created_at DESC);

ALTER TABLE asset_validation_qa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_validation_qa_tenant ON asset_validation_qa;
CREATE POLICY asset_validation_qa_tenant
    ON asset_validation_qa
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE ON asset_validation_qa TO factorylm_app;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────
-- DOWN
-- ────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS asset_validation_qa_tenant ON asset_validation_qa;
-- DROP TABLE IF EXISTS asset_validation_qa;
-- COMMIT;

BEGIN;

-- Migration 046: asset_agent_status + asset_validation_qa.
--
-- Spec : docs/specs/asset-agent-validation-spec.md §6 ("Data model")
-- Rule : .claude/rules/train-before-deploy.md
--
-- "Train before deploy": the Command Center builds + validates an asset agent;
-- Ignition/HMI only answers for an *approved/deployed* agent. These two tables
-- hold the per-kg_entity lifecycle and the validation transcript a human signs
-- off on. They COMPOSE existing primitives (kg_entities.approval_state — mig
-- 029, ai_suggestions — mig 027, engine 1-5 groundedness) rather than re-score.
--
-- Granularity note: this is PER kg_entity (one asset/component). It is NOT the
-- per-tenant namespace L0-L6 health score (mira-hub/src/lib/health-score.ts).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN guards.

-- ── asset_agent_status: one row per kg_entity with (or building toward) an agent ──
CREATE TABLE IF NOT EXISTS asset_agent_status (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    kg_entity_id    UUID NOT NULL,                 -- the asset/component (kg_entities.id)

    -- Lifecycle. Promotion to 'approved' is ALWAYS a human action (requires
    -- approved_by) — same rule as KG edge promotion (TOO Invariant 4).
    state           TEXT NOT NULL DEFAULT 'draft'
        CHECK (state IN (
            'draft', 'training', 'validating', 'approved',
            'deployed', 'rejected', 'deprecated'
        )),

    approved_by     TEXT,                           -- 'human:user_<uuid>' — REQUIRED to enter 'approved'
    approved_at     TIMESTAMPTZ,
    deployed_at     TIMESTAMPTZ,
    deploy_surface  TEXT
        CHECK (deploy_surface IS NULL OR deploy_surface IN (
            'ignition', 'perspective', 'hub_display', 'qr'
        )),

    -- Cached acceptance evidence (recomputed by the validation flow).
    citation_coverage  INTEGER NOT NULL DEFAULT 0,  -- # validation Q with >=1 citation
    min_groundedness   SMALLINT,                    -- lowest groundedness across counted answers
    notes              TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, kg_entity_id),
    CHECK (state <> 'approved' OR approved_by IS NOT NULL)
);

-- Deployment gate hot path: ignition_chat.py looks up the state for one asset.
CREATE INDEX IF NOT EXISTS idx_asset_agent_status_lookup
    ON asset_agent_status (tenant_id, kg_entity_id);

-- "Show me everything ready for / live on the HMI."
CREATE INDEX IF NOT EXISTS idx_asset_agent_status_deployable
    ON asset_agent_status (tenant_id, state)
    WHERE state IN ('approved', 'deployed');

-- ── asset_validation_qa: the validation transcript an approver signs off on ──
CREATE TABLE IF NOT EXISTS asset_validation_qa (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    kg_entity_id    UUID NOT NULL,

    question        TEXT NOT NULL,
    mira_answer     TEXT,
    citations       JSONB NOT NULL DEFAULT '[]'::JSONB,   -- [{doc_id, page, source_url}]
    groundedness    SMALLINT                              -- engine 1-5, copied from the turn
        CHECK (groundedness IS NULL OR groundedness BETWEEN 1 AND 5),
    evidence_utilization REAL,                            -- from benchmark_db

    reviewer_verdict TEXT
        CHECK (reviewer_verdict IS NULL OR reviewer_verdict IN ('good', 'bad', 'needs_review')),
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_validation_qa_entity
    ON asset_validation_qa (tenant_id, kg_entity_id, created_at DESC);

-- "How many cited+good answers does this asset have?" — the acceptance query.
CREATE INDEX IF NOT EXISTS idx_asset_validation_qa_good
    ON asset_validation_qa (tenant_id, kg_entity_id)
    WHERE reviewer_verdict = 'good';

-- ── RLS (mirror 027_ai_suggestions.sql) ──
ALTER TABLE asset_agent_status   ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_validation_qa  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_agent_status_tenant ON asset_agent_status;
CREATE POLICY asset_agent_status_tenant
    ON asset_agent_status
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

DROP POLICY IF EXISTS asset_validation_qa_tenant ON asset_validation_qa;
CREATE POLICY asset_validation_qa_tenant
    ON asset_validation_qa
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE ON asset_agent_status  TO factorylm_app;
GRANT SELECT, INSERT, UPDATE ON asset_validation_qa TO factorylm_app;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS asset_agent_status_tenant ON asset_agent_status;
-- DROP POLICY IF EXISTS asset_validation_qa_tenant ON asset_validation_qa;
-- DROP TABLE IF EXISTS asset_validation_qa;
-- DROP TABLE IF EXISTS asset_agent_status;
-- COMMIT;

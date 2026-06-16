BEGIN;

-- Migration 021: namespace-builder Phase 2 product-surface tables.
-- Spec: docs/specs/maintenance-namespace-builder-spec.md
-- Plan: docs/plans/2026-05-15-maintenance-namespace-builder.md  (Phase 2)
-- ADR : docs/adr/0013-uns-namespace-builder-schema-canonicalization.md
--
-- Three tables, one stewardship boundary:
--
--   health_scores       L0-L6 readiness per (tenant_id, scope, scope_path).
--                       Cached output of `mira-hub/src/lib/health-score.ts`,
--                       not authoritative source. Recompute is event-driven
--                       (Phase 2 slice 3) — for slice 1 the read endpoint
--                       computes on demand and writes through.
--
--   wizard_progress     Per-tenant onboarding-wizard state. Phase 3 owns the
--                       wizard UI; we land the table now so Phase 2 readiness
--                       can count "wizard completed" as a level signal without
--                       a follow-up schema PR.
--
--   namespace_versions  Append-only audit of namespace edits (drag-drop,
--                       rename, merge). Phase 2 slice 2 (drag-drop) writes
--                       these rows; slice 1 only creates the table so the
--                       read endpoint can pre-declare it in queries.
--
-- ADR-0013 reminder: we do NOT add `ai_suggestions` here. Hub migration 018
-- (relationship_proposals) is the canonical proposals queue. Phase 2 reads
-- pending proposals from there.


-- ────────────────────────────────────────────────────────────────────────────
-- health_scores — cached L0-L6 per scope.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- 'tenant' for the global score on /feed; 'path' for a namespace subtree
    -- (path stored as ltree string). One row per (tenant_id, scope,
    -- scope_path) — UPSERT on recompute.
    scope TEXT NOT NULL CHECK (scope IN ('tenant', 'path')),
    scope_path TEXT NOT NULL DEFAULT '',

    -- The readiness level: L0 (no data) through L6 (production-ready).
    -- Stored as 0-6 integer; the UI / API translate to "L0" labels.
    level SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 6),

    -- One-line "next step" hint surfaced on the widget. Pure-function output
    -- from health-score.ts; recomputed when level changes.
    next_step TEXT NOT NULL DEFAULT '',

    -- Raw counts the calculator consumed. JSONB so the calculator can evolve
    -- without schema changes. Shape:
    --   {
    --     "assets": 12,
    --     "components": 41,
    --     "docs": 8,
    --     "proposals_pending": 3,
    --     "proposals_verified": 27,
    --     "uns_paths": 14,
    --     "wizard_completed": true
    --   }
    counts JSONB NOT NULL DEFAULT '{}'::JSONB,

    -- Provenance for the cached row — lets the worker know whether the row is
    -- stale (older than threshold env var). NULL on insert; updated on
    -- recompute.
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_event_at TIMESTAMPTZ,           -- timestamp of the event that triggered the recompute

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, scope, scope_path)
);

CREATE INDEX IF NOT EXISTS idx_health_scores_tenant
    ON health_scores (tenant_id);
CREATE INDEX IF NOT EXISTS idx_health_scores_scope
    ON health_scores (tenant_id, scope, scope_path);
CREATE INDEX IF NOT EXISTS idx_health_scores_level
    ON health_scores (tenant_id, level);

ALTER TABLE health_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_scores_tenant ON health_scores;
CREATE POLICY health_scores_tenant
    ON health_scores
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);


-- ────────────────────────────────────────────────────────────────────────────
-- wizard_progress — onboarding wizard state per tenant.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wizard_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- One wizard per tenant for v1. Future: per-user wizards keyed on user_id.
    wizard_kind TEXT NOT NULL DEFAULT 'namespace_onboarding',

    -- 'in_progress' | 'completed' | 'abandoned'. Phase 3 enforces.
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'abandoned')),

    -- Step identifier the user is currently on. String not enum so Phase 3
    -- can add steps without schema migrations.
    current_step TEXT NOT NULL DEFAULT 'company',

    -- Saved payloads per step. Shape: {"company": {...}, "site": {...}, ...}.
    step_payloads JSONB NOT NULL DEFAULT '{}'::JSONB,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, wizard_kind)
);

CREATE INDEX IF NOT EXISTS idx_wizard_progress_tenant
    ON wizard_progress (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wizard_progress_status
    ON wizard_progress (tenant_id, status);

ALTER TABLE wizard_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wizard_progress_tenant ON wizard_progress;
CREATE POLICY wizard_progress_tenant
    ON wizard_progress
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);


-- ────────────────────────────────────────────────────────────────────────────
-- namespace_versions — append-only audit of namespace tree edits.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS namespace_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- 'move' | 'rename' | 'create' | 'delete' (delete is soft — see metadata).
    -- Slice-1 schema only; Phase 2 slice 2 writes rows here from the drag-drop
    -- endpoint.
    operation TEXT NOT NULL
        CHECK (operation IN ('move', 'rename', 'create', 'delete')),

    -- Entity affected. References kg_entities.id but no FK so we can record
    -- moves that touched entities later deleted by a downstream merge.
    entity_id UUID NOT NULL,
    entity_kind TEXT,                       -- 'asset' | 'component' | 'line' | 'area' | ...

    -- Before / after representation. Shape:
    --   from: {"uns_path": "...", "name": "..."}
    --   to:   {"uns_path": "...", "name": "..."}
    -- Either can be NULL on create / delete.
    from_state JSONB,
    to_state JSONB,

    -- Audit trail.
    actor_user_id UUID,                     -- nullable for system-driven changes
    actor_kind TEXT NOT NULL DEFAULT 'human'
        CHECK (actor_kind IN ('human', 'agent', 'system')),
    reason TEXT,                            -- free-text from the UI

    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_namespace_versions_tenant
    ON namespace_versions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_namespace_versions_entity
    ON namespace_versions (tenant_id, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_namespace_versions_op
    ON namespace_versions (tenant_id, operation);

ALTER TABLE namespace_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS namespace_versions_tenant ON namespace_versions;
CREATE POLICY namespace_versions_tenant
    ON namespace_versions
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);


COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- DOWN (manual rollback) — run with caution; drops cached scores + audit log.
-- ────────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS namespace_versions CASCADE;
-- DROP TABLE IF EXISTS wizard_progress CASCADE;
-- DROP TABLE IF EXISTS health_scores CASCADE;
-- COMMIT;

BEGIN;

-- Migration 032: decision_traces — append-only audit of every grounded
-- troubleshooting turn MIRA produces.
--
-- Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md
--   Phase 1 (§2) + deliverable D5. Gap-closure plan:
--   docs/plans/current-state-gap-closure-plan.md (REPORT stage).
-- Doctrine:    docs/THEORY_OF_OPERATIONS.md Invariant #6 ("all
--              troubleshooting is grounded") + Cluster Law 1
--              ("evidence-only completion"). You cannot audit groundedness
--              without a durable trace.
--
-- WHAT THIS IS
--   One row per troubleshooting turn that reached the diagnosis path. It
--   ties together the evidence MIRA actually used (tags, manuals, KG edges),
--   the recommendation it gave, whether a citation was present, whether the
--   technician confirmed, and the outcome. This is the clinical record per
--   incident-turn; mira-bots/shared/benchmark_db.py stays the lighter
--   regression-focused per-turn eval log (the two are intentionally
--   distinct — see master plan D5).
--
-- KEYING — append-only. trace_id is a UUID PK; the logical key is
--   (tenant_id, ts), indexed. No UPDATE / DELETE from the app role.
--
-- UUID NOTE — the master plan's first-pass SQL suggested UUIDv7 for
--   sortability. The rest of the Hub schema uses gen_random_uuid()
--   (Postgres-native, no extension, works on NeonDB today), so we follow
--   the house convention and rely on the (tenant_id, ts) index for
--   time-ordering. Recorded in ADR-0022.
--
-- EVIDENCE COLUMNS — tag_evidence / manual_evidence / kg_evidence are JSONB
--   so the heavy, variable-shape payloads don't force per-turn schema
--   churn. Shapes:
--     tag_evidence    : [{ "tag_path": "...", "uns_path": "...",
--                          "value": "...", "event_id": "uuid", "ts": "..." }]
--     manual_evidence : [{ "chunk_id": "...", "doc": "...", "page": <int>,
--                          "score": <float> }]
--     kg_evidence     : [{ "entity_id": "...", "rel": "...", "target": "..." }]
--   The technician's question + recommendation are stored PII-sanitized
--   (InferenceRouter.sanitize_text — IP/MAC/SN scrubbed at write time), same
--   contract as 031_ignition_audit_log.
--
-- TENANT ISOLATION — RLS keyed on the session-local tenant binding, same
--   dual-setting form used by the signal-family tables (019/020/025) so a
--   writer that already SET app.tenant_id keeps working.
--
-- WHY HUB SCHEMA (not docs/migrations/) — ADR-0013: Hub owns user-facing
--   tables. The future Hub /decision-traces admin page reads here.
--
-- RETENTION — open question D8 #8 (90-day raw + daily rollup proposed,
--   pending Mike's sign-off). NOT implemented here; default keep-forever.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS decision_traces (
    trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Optional link to the incident this turn belongs to (Hub 019). Nullable
    -- because direct-connection / one-shot turns may not open a session.
    session_id UUID REFERENCES troubleshooting_sessions(id) ON DELETE SET NULL,

    -- Where the turn came from. "slack" | "telegram" | "ignition" | "hub" |
    -- "web". Free-form (low cardinality) so a new surface needs no schema bump.
    platform TEXT,

    -- The confirmed / resolved location for this turn. Nullable when the gate
    -- did not resolve a path (e.g. an educational question).
    uns_path LTREE,

    -- The technician's question, sanitized at write time.
    user_question TEXT NOT NULL,

    -- Evidence MIRA actually consulted on this turn (see header for shapes).
    tag_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    manual_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    kg_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- The recommendation MIRA gave (sanitized).
    recommendation TEXT,

    -- Groundedness outcome. citations_present = the reply cited >=1 source.
    citations_present BOOLEAN NOT NULL DEFAULT false,

    -- Whether the technician confirmed the diagnosis / context (NULL = not
    -- asked / not yet answered).
    technician_confirmed BOOLEAN,

    -- Turn outcome — "resolved" | "handoff" | "kb_gap" | "gate_fired" |
    -- "engine_error" | ... Free-form, low cardinality.
    outcome TEXT,

    -- Cascade attribution (Groq / Cerebras / Gemini — never Anthropic) +
    -- end-to-end latency. Both nullable (gate-fired turns make no LLM call).
    model_used TEXT,
    latency_ms INTEGER,

    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column guard: if the table existed before this migration was
-- updated to add citations_present, ALTER TABLE brings it in line.
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS
    citations_present BOOLEAN NOT NULL DEFAULT false;

-- Admin tail "last N traces for tenant X" dominates the read path.
CREATE INDEX IF NOT EXISTS decision_traces_tenant_time_idx
    ON decision_traces (tenant_id, ts DESC);

-- "All traces for this incident".
CREATE INDEX IF NOT EXISTS decision_traces_session_idx
    ON decision_traces (session_id)
    WHERE session_id IS NOT NULL;

-- Subtree audit: "every trace under <line>".
CREATE INDEX IF NOT EXISTS decision_traces_uns_path_gist
    ON decision_traces USING GIST (uns_path);

-- Groundedness sweep: find ungrounded replies fast.
CREATE INDEX IF NOT EXISTS decision_traces_uncited_idx
    ON decision_traces (tenant_id, ts DESC)
    WHERE citations_present = false;

ALTER TABLE decision_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_traces_tenant ON decision_traces;
CREATE POLICY decision_traces_tenant
    ON decision_traces
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Append-only: the app role may read + insert, never mutate or delete.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT ON decision_traces TO factorylm_app;
    END IF;
END $$;
REVOKE UPDATE, DELETE ON decision_traces FROM PUBLIC;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS decision_traces_tenant ON decision_traces;
-- DROP TABLE IF EXISTS decision_traces;
-- COMMIT;

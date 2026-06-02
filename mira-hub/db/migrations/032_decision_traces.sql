-- 032_decision_traces.sql
-- Purpose : Append-only audit table — one row per engine turn, capturing the
--           full decision chain: UNS gate outcome, retrieval set, KG hops,
--           tag events consulted, cascade failures, citation check, latency.
-- Plan    : docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1 / §D2 / §D5
-- ADR     : docs/adr/0022-decision-trace-storage.md
-- Writer  : mira-bots/shared/decision_trace.py (Phase 8)
-- UI      : Hub /decision-traces (Phase 8)

BEGIN;

CREATE TABLE IF NOT EXISTS decision_traces (
  trace_id         UUID PRIMARY KEY,                        -- UUIDv7 (caller-assigned for ordering)
  tenant_id        UUID NOT NULL,
  session_id       UUID REFERENCES troubleshooting_sessions(id),
  chat_id          TEXT NOT NULL,                           -- platform-scoped thread/channel id
  platform         TEXT NOT NULL,                           -- slack|telegram|ignition|hub|web
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- User message — stored sanitized; InferenceRouter.sanitize_context()
  -- strips IP/MAC/SN before this row is written.
  user_message     TEXT NOT NULL,                           -- sanitized

  -- Routing & gate
  router_intent    TEXT,                                    -- classifier intent label
  gate_outcome     TEXT,                                    -- direct_connection|confirmed|fired|skipped

  -- UNS resolution
  uns_path         LTREE,                                   -- requires: CREATE EXTENSION IF NOT EXISTS ltree (verify on staging)
  uns_confidence   TEXT,                                    -- band per docs/specs/uns-message-resolver-spec.md §2.4

  -- Evidence chain (heavy columns stored as JSONB to keep the row scannable)
  retrieval_set    JSONB,                                   -- [{chunk_id, score, source}]
  kg_hops          JSONB,                                   -- [{entity_id, type, rel}]
  tag_events_consulted JSONB,                               -- [event_id, ...]

  -- LLM call
  prompt           TEXT,                                    -- sanitized
  model_used       TEXT,                                    -- groq|cerebras|gemini|...
  llm_latency_ms   INT,
  cascade_failures JSONB,                                   -- [{provider, error}]

  -- Reply processing
  raw_reply        TEXT,
  citation_check   TEXT,                                    -- pass|rewritten|admitted_gap
  final_reply      TEXT,

  -- Timing & state
  total_latency_ms INT,
  next_state       TEXT,

  CONSTRAINT decision_traces_tenant_ts_idx UNIQUE (trace_id, tenant_id)
);

-- Tenant-scoped time-series scan (primary read path for trace history)
CREATE INDEX IF NOT EXISTS idx_decision_traces_tenant_ts
  ON decision_traces (tenant_id, ts DESC);

-- Session-scoped lookup (used by list_decision_traces MCP tool)
CREATE INDEX IF NOT EXISTS idx_decision_traces_session
  ON decision_traces (session_id);

-- UNS spatial lookup (asset-scoped trace queries)
CREATE INDEX IF NOT EXISTS idx_decision_traces_uns_path
  ON decision_traces USING GIST (uns_path);

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_decision_traces_uns_path;
-- DROP INDEX IF EXISTS idx_decision_traces_session;
-- DROP INDEX IF EXISTS idx_decision_traces_tenant_ts;
-- DROP TABLE IF EXISTS decision_traces;
-- COMMIT;

BEGIN;

-- Migration 031: kg_query_traces — persist the reasoning subgraph behind an answer.
--
-- Spec : docs/superpowers/specs/2026-06-02-kg-relationship-graph-design.md
-- Plan : docs/superpowers/plans/2026-06-02-kg-graph-phase3-reasoning-trace.md
--
-- Why:
--   When MIRA answers a question (POST /api/mira/ask) it already builds a
--   `grounding` object listing the kg entities + edges it consulted, but throws
--   it away. Phase 3 records that set so the /graph page can highlight "the
--   subgraph MIRA traversed to answer" — making the visual a window into the
--   agent's reasoning. Capture is best-effort and never blocks an answer.
--
--   entity_ids holds kg_entities.id UUIDs (same ids the graph renders, so the
--   client highlights by id directly). edges is an informational JSONB snapshot
--   ([{sName,tName,type,confidence}]); the graph derives emphasized edges from
--   entity_ids membership, so it does not depend on edge UUIDs.

CREATE TABLE IF NOT EXISTS kg_query_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES troubleshooting_sessions(id) ON DELETE CASCADE,
  question_turn_index INT NOT NULL DEFAULT 0,
  root_id UUID,                              -- anchor equipment entity
  question TEXT,
  answer_provider TEXT,
  entity_ids UUID[] NOT NULL DEFAULT '{}',   -- kg_entities.id traversed
  edges JSONB NOT NULL DEFAULT '[]',         -- [{sName,tName,type,confidence}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kg_traces_session
  ON kg_query_traces (session_id);
CREATE INDEX IF NOT EXISTS idx_kg_traces_tenant_session
  ON kg_query_traces (tenant_id, session_id, created_at DESC);

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN
-- ----------------------------------------------------------------------------
--
-- BEGIN;
-- DROP TABLE IF EXISTS kg_query_traces;
-- COMMIT;

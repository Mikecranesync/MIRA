BEGIN;

-- Migration 031: ignition_audit_log — durable trail of every Ignition chat
-- round-trip + cited sources + tag reads.
--
-- Spec / issue: GitHub #1624 (audit task D7).
-- Doctrine:     docs/mira-ignition-secure-architecture.md §4.5 "Audit".
--
-- WHAT THIS IS
--   Every chat request that hits POST /api/v1/ignition/chat lands one row
--   here at the end of the round-trip. The row carries the prompt (PII-
--   sanitized — IPs/MACs/serials scrubbed at write time), the cited sources
--   from the engine response, the list of tag paths read from Ignition's
--   allowlist during this turn, and the LLM provider/model that produced
--   the answer. This is the compliance trail an auditor or a customer's
--   security team can replay end-to-end without revealing live plant data.
--
-- KEYING — append-only. No updates, no deletes. The PK is a UUID; the
--   logical "key" for a row is (tenant_id, created_at), which we index.
--
-- TENANT ISOLATION — Hub uses row-level security keyed by
--   app.current_tenant_id. The policy below restricts SELECT to rows whose
--   tenant_id matches the session-local setting; INSERT requires the same
--   binding. Same pattern as 027_ai_suggestions / 030_display_endpoints.
--
-- WHY THIS LIVES IN HUB SCHEMA (not docs/migrations/)
--   ADR-0013: Hub schema is authoritative for user-facing tables. The
--   admin/audit Perspective view + the future Hub /audit page read from
--   this table; the engine-side write goes through the same connection.
--
-- RETENTION — open question for the security review (issue #1624 follow-up).
--   Default: keep forever. The table is small per row (≈1 KB) and rows are
--   high-value for compliance. If a customer requires hard expiry, add a
--   per-tenant retention_days column and a nightly purge — explicitly NOT
--   in this migration.

CREATE TABLE IF NOT EXISTS ignition_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Where the turn came from. "ignition" today; future channels
    -- (mqtt, hub_panel, slack-bench) reuse this column without a schema
    -- change. NOT an enum — append-only on values matches the rest of Hub.
    channel TEXT NOT NULL DEFAULT 'ignition',

    -- Identity. user_id is the technician's id when supplied by the
    -- Ignition session; falls back to the chat_id the engine used for FSM
    -- state. asset_id is the equipment context the chat was bound to.
    user_id TEXT,
    asset_id TEXT,
    chat_id TEXT,

    -- The technician's question, sanitized at write time
    -- (InferenceRouter.sanitize_text — IP/MAC/SN regexes). We DO NOT store
    -- the unsanitized form. If a future feature needs the original, it
    -- joins to mira_chat_history; the audit trail itself stays PII-clean.
    prompt TEXT NOT NULL,
    prompt_chars INTEGER,

    -- The engine's answer (sanitized) and the cited sources packed as JSON.
    -- sources_json shape mirrors the chat endpoint response:
    --   [{ "type": "manual"|"work_order"|"kg_entity"|"tag", "id": "...",
    --      "title": "...", "page": <int|null>, "url": "...|null" }, ...]
    answer TEXT,
    answer_chars INTEGER,
    sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Every tag path Ignition read from the allowlist during this turn.
    -- Pure path strings; values stay in mira-relay's equipment_status / on
    -- the gateway. This column answers "which tags did MIRA see?".
    tag_reads_json JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Cascade attribution. Provider/model are what actually produced the
    -- answer (Groq/Cerebras/Gemini, never Anthropic). inference_run_id is
    -- the run id from shared/telemetry.
    llm_provider TEXT,
    llm_model TEXT,
    inference_run_id TEXT,

    -- Performance — latency_ms is end-to-end from POST in to JSON out.
    latency_ms INTEGER,

    -- Outcome — "ok" | "engine_error" | "auth_failure" | "rate_limited" | …
    -- Free-form; the cardinality stays low in practice but the column is
    -- TEXT so new states don't need a schema bump.
    status TEXT NOT NULL DEFAULT 'ok',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant + time scans dominate the read path (admin tail "last N for tenant X").
CREATE INDEX IF NOT EXISTS ignition_audit_log_tenant_time_idx
    ON ignition_audit_log (tenant_id, created_at DESC);

-- "Show me all chats about asset X" — secondary, but cheap.
CREATE INDEX IF NOT EXISTS ignition_audit_log_asset_idx
    ON ignition_audit_log (tenant_id, asset_id, created_at DESC)
    WHERE asset_id IS NOT NULL;

-- Row-level security: a session must set app.current_tenant_id before
-- reading or writing. The Hub /audit handler and the pipeline writer both
-- SET LOCAL it after acquiring the connection.
ALTER TABLE ignition_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ignition_audit_log_tenant_isolation ON ignition_audit_log;
CREATE POLICY ignition_audit_log_tenant_isolation
    ON ignition_audit_log
    USING (tenant_id::text = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

-- Append-only enforcement: no UPDATE, no DELETE from the application role.
-- The migration role keeps full privilege for ops.
REVOKE UPDATE, DELETE ON ignition_audit_log FROM PUBLIC;

COMMIT;

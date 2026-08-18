-- 078_channel_workflow.sql — canonical channel operation + conversation workspace.
--
-- Issue: #3299
-- Spec : docs/architecture/convergence/units/CU-CHANNEL-WORKFLOW.md
--
-- Why workflow_runs is not reused as the execution lock:
--   its documented idempotency behavior intentionally resets a conflicting row
--   to running and re-executes the body, and the table is deliberately not an
--   RLS customer-data boundary. Channel results contain tenant equipment/file
--   provenance and require exactly-once execution + terminal delivery.
--
-- This migration is additive and forward-only. Application rollback disables
-- MIRA_CHANNEL_WORKFLOW_ENABLED first and leaves these audit rows intact.

BEGIN;

-- A conversation from a thin client binds to one canonical Equipment Notebook.
-- Existing rows keep NULL external_conversation_id and are outside the new
-- unique index; no backfill or identity guess is performed.
ALTER TABLE troubleshooting_sessions
  ADD COLUMN IF NOT EXISTS external_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notebook_id UUID,
  ADD COLUMN IF NOT EXISTS selected_node_id UUID,
  ADD COLUMN IF NOT EXISTS equipment_identity JSONB,
  ADD COLUMN IF NOT EXISTS last_file_id UUID,
  ADD COLUMN IF NOT EXISTS last_doc_id UUID,
  ADD COLUMN IF NOT EXISTS pending_intent TEXT,
  ADD COLUMN IF NOT EXISTS pending_operation_id UUID;

ALTER TABLE troubleshooting_sessions
  DROP CONSTRAINT IF EXISTS troubleshooting_sessions_pending_intent_check;
ALTER TABLE troubleshooting_sessions
  ADD CONSTRAINT troubleshooting_sessions_pending_intent_check
  CHECK (pending_intent IS NULL OR pending_intent IN ('manual_discovery'));

ALTER TABLE troubleshooting_sessions
  DROP CONSTRAINT IF EXISTS troubleshooting_sessions_channel_check;
ALTER TABLE troubleshooting_sessions
  ADD CONSTRAINT troubleshooting_sessions_channel_check
  CHECK (channel IN ('tablet', 'slack', 'telegram', 'web', 'hub', 'mobile', 'other'));

ALTER TABLE troubleshooting_sessions
  DROP CONSTRAINT IF EXISTS troubleshooting_sessions_generation_check;
ALTER TABLE troubleshooting_sessions
  ADD CONSTRAINT troubleshooting_sessions_generation_check CHECK (generation > 0);

-- A canonical File is linked to the active conversation as well as its
-- notebook/asset. This is the durable answer to "what did I just upload?";
-- channel-local memory is not part of possession or retrieval truth.
ALTER TABLE workspace_file_links
  DROP CONSTRAINT IF EXISTS workspace_file_links_target_type_check;
ALTER TABLE workspace_file_links
  ADD CONSTRAINT workspace_file_links_target_type_check
  CHECK (target_type IN (
    'equipment_notebook', 'cmms_asset', 'namespace_node', 'work_order',
    'troubleshooting_session'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_troubleshooting_sessions_active_channel_conversation
  ON troubleshooting_sessions (tenant_id, channel, external_conversation_id)
  WHERE external_conversation_id IS NOT NULL
    AND status IN ('awaiting_namespace', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_troubleshooting_sessions_channel_conversation_history
  ON troubleshooting_sessions
     (tenant_id, channel, external_conversation_id, generation DESC)
  WHERE external_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_operations (
  operation_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  session_id                UUID NOT NULL,
  channel                   TEXT NOT NULL
    CHECK (channel IN ('telegram', 'slack', 'hub', 'mobile')),
  event_id                  TEXT NOT NULL,
  request_fingerprint       TEXT NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  request_envelope          JSONB NOT NULL,
  state                     TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued', 'running', 'complete', 'candidate_review',
      'insufficient_evidence', 'failed', 'cancelled'
    )),
  semantic_kind             TEXT,
  progress_step             TEXT NOT NULL DEFAULT 'prepared'
    CHECK (progress_step IN (
      'prepared', 'recognizing_nameplate', 'discovering_manual',
      'ingesting_file', 'answering_from_files', 'resetting_workspace'
    )),
  result                    JSONB,
  owner_token               UUID,
  owner_lease_expires_at    TIMESTAMPTZ,
  delivery_token            UUID,
  delivery_lease_expires_at TIMESTAMPTZ,
  terminal_delivered_at     TIMESTAMPTZ,
  started_at                TIMESTAMPTZ,
  finished_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_operations_tenant_event
    UNIQUE (tenant_id, channel, event_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_operations_session_recent
  ON channel_operations (tenant_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_operations_running_lease
  ON channel_operations (owner_lease_expires_at)
  WHERE state IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_channel_operations_delivery_lease
  ON channel_operations (delivery_lease_expires_at)
  WHERE terminal_delivered_at IS NULL
    AND state IN ('complete', 'candidate_review', 'insufficient_evidence', 'failed');

ALTER TABLE channel_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_operations_tenant_isolation ON channel_operations;
CREATE POLICY channel_operations_tenant_isolation ON channel_operations
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON channel_operations TO factorylm_app;

COMMENT ON TABLE channel_operations IS
  'RLS-scoped exactly-once channel workflow operations, semantic results, and terminal-delivery leases (#3299).';
COMMENT ON COLUMN channel_operations.request_envelope IS
  'Normalized v1 provenance: actor/uploader, source channel/event/conversation, attachment MIME/name/size/SHA, and user intent.';

COMMIT;

-- Recovery (human-authorized only, after disabling the feature):
-- BEGIN;
-- DROP TABLE IF EXISTS channel_operations;
-- DROP INDEX IF EXISTS uq_troubleshooting_sessions_active_channel_conversation;
-- DROP INDEX IF EXISTS idx_troubleshooting_sessions_channel_conversation_history;
-- ALTER TABLE troubleshooting_sessions
--   DROP COLUMN IF EXISTS external_conversation_id,
--   DROP COLUMN IF EXISTS generation,
--   DROP COLUMN IF EXISTS notebook_id,
--   DROP COLUMN IF EXISTS selected_node_id,
--   DROP COLUMN IF EXISTS equipment_identity,
--   DROP COLUMN IF EXISTS last_file_id,
--   DROP COLUMN IF EXISTS last_doc_id,
--   DROP COLUMN IF EXISTS pending_intent,
--   DROP COLUMN IF EXISTS pending_operation_id;
-- COMMIT;

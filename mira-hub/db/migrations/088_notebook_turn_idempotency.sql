-- 088: one durable notebook turn per logical client send.
--
-- Chat is streamed after server-side work. A connection can fail after the
-- turn commits but before the client receives a safety marker or response
-- headers. Retry therefore reuses a client-minted UUID; this partial unique
-- index prevents a second durable row within the authenticated owner/notebook
-- scope while preserving legacy clients that send no key.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_equipment_notebook_turns_client_request;
--   ALTER TABLE equipment_notebook_turns DROP COLUMN IF EXISTS client_request_id;

ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS client_request_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_notebook_turns_client_request
  ON equipment_notebook_turns
    (tenant_id, notebook_id, owner_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN equipment_notebook_turns.client_request_id IS
  'Client-minted UUID stable across Retry; deduplicates one logical send per owner and notebook.';

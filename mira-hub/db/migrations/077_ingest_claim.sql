-- 077_ingest_claim.sql — atomic ingestion claim on canonical files (Codex P1, 2026-08-16)
--
-- Problem: two concurrent identical uploads both pass parkOrReuseFile's
-- pre-check window. The loser re-selects the winner's row BEFORE the winner
-- has finished ingesting (upload_id still NULL), reads `reused=true,
-- uploadId=null`, concludes "not ingested yet" and ingests AGAIN — duplicate
-- hub_uploads + duplicate knowledge_entries chunk sets for one byte-identical
-- file.
--
-- Fix: a test-and-set claim on the canonical row. Exactly one request can
-- claim a row for ingestion; everyone else sees the claim and reports an
-- explicit "ingest_in_progress" partial instead of double-ingesting. A stale
-- claim (crashed worker) is take-over-able after the timeout in code.
--
-- Idempotent; single transaction; forward-only (applied migrations are
-- immutable — see .claude/rules/mira-hub-migrations.md).

BEGIN;

ALTER TABLE namespace_direct_uploads
  ADD COLUMN IF NOT EXISTS ingest_claim_token uuid,
  ADD COLUMN IF NOT EXISTS ingest_claimed_at  timestamptz;

COMMENT ON COLUMN namespace_direct_uploads.ingest_claim_token IS
  'Atomic ingestion claim: set by the one request allowed to ingest this file; cleared when upload_id lands. Stale claims (> ~10 min) may be taken over.';

COMMIT;

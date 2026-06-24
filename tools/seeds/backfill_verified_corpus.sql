-- Backfill knowledge_entries.verified for approval-gated retrieval (PR: garage-conveyor mission).
--
-- WHY: feat(retrieval) adds MIRA_ENFORCE_APPROVED_RETRIEVAL, which restricts
-- recall_knowledge to verified=true chunks. The `verified` column has defaulted to
-- FALSE since migration 001 and was never set, so enabling the gate WITHOUT this
-- backfill drops retrieval from ~83.8k chunks to a few hundred — it breaks everything.
--
-- POLICY (the deliberate approval decision encoded here):
--   1. The shared OEM knowledge library (the system tenant) is TRUSTED BY DEFAULT —
--      it is curated, public, OEM-sourced manual content. Mark it verified=true so it
--      remains citable when the gate is on.
--   2. Per-tenant CUSTOMER uploads are NOT auto-approved. They stay verified=false until
--      a human approves them in the Hub (the approval action sets verified=true). That is
--      the whole point of the gate — a customer's un-reviewed upload is not citable yet.
--
-- This is idempotent and safe to re-run. Apply to STAGING first (factorylm/stg), verify
-- retrieval with the gate on, then PROD via apply-seeds.yml — never psql prod directly.
--
-- Verify after:  SELECT verified, count(*) FROM knowledge_entries GROUP BY 1;

BEGIN;

-- 1. Shared OEM library = approved by default (the trusted public corpus).
UPDATE knowledge_entries
   SET verified = true
 WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid   -- MIRA_SHARED_TENANT_ID (OEM pool)
   AND verified IS DISTINCT FROM true;

-- 2. SimLab synthetic demo corpus = approved (it is our own ground-truth demo content).
UPDATE knowledge_entries
   SET verified = true
 WHERE tenant_id = '00000000-0000-0000-0000-000000515ab1'::uuid   -- SIMLAB_TENANT_ID
   AND verified IS DISTINCT FROM true;

-- NOTE: real per-customer tenants (e.g. Mike's garage) are intentionally NOT backfilled.
-- Their uploads are approved one-by-one through the Hub, which is what makes the gate mean
-- something. The golden-path test seeds a deliberate approved/unapproved mix to prove this.

COMMIT;

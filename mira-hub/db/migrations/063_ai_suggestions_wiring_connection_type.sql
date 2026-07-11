BEGIN;

-- Migration 063: Add 'wiring_connection' to ai_suggestions.suggestion_type enum.
--
-- Context:
--   Issue #2605 routes LLM-derived wiring_connections rows through ai_suggestions
--   so the Hub `/proposals` review UI can approve them (mig-026 doctrine fulfilled).
--   Every wiring proposal lands as one ai_suggestions row of type 'wiring_connection',
--   with extracted_data.wiring_connection_id pointing at the row being proposed.
--
-- Spec : docs/specs/maintenance-namespace-builder-spec.md §"Proposal queue"
-- ADR  : docs/adr/0017-proposal-state-machine-mapping.md (status enum mapping)
-- Issue: #2605 (wiring_connections review surface)
--
-- Schema implications:
--   ai_suggestions.suggestion_type CHECK: add 'wiring_connection' value.
--   ai_suggestions.extracted_data (for type='wiring_connection'):
--     { "wiring_connection_id": <uuid>, ... }
--
--   The wiring_connections.approval_state is written directly by the decide route
--   (not through a helper — mirrors tag_entities precedent). The ai_suggestions row
--   owns the proposal lifecycle (pending→accepted/rejected via applyHubProposalTransition).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS; ADD CONSTRAINT.
--
-- Tenant scoping (rule §1 "tenant_id type matching"):
--   ai_suggestions.tenant_id is UUID (mig-027). wiring_connections.tenant_id is also
--   UUID (mig-026). No type mismatch; straightforward JOIN/RLS.
--
-- GRANT: ai_suggestions already GRANTs to factorylm_app (mig-027). No new GRANT needed.

ALTER TABLE ai_suggestions
  DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;

ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_suggestion_type_check CHECK (
    suggestion_type IN (
      'kg_edge',
      'kg_entity',
      'tag_mapping',
      'component_profile',
      'uns_confirmation',
      'namespace_move',
      'wiring_connection'
    )
  );

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE ai_suggestions
--   DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;
-- ALTER TABLE ai_suggestions
--   ADD CONSTRAINT ai_suggestions_suggestion_type_check CHECK (
--     suggestion_type IN (
--       'kg_edge',
--       'kg_entity',
--       'tag_mapping',
--       'component_profile',
--       'uns_confirmation',
--       'namespace_move'
--     )
--   );
-- COMMIT;

-- 084: durable evidence contract for notebook conversations (Copilot PRD P2).
--
-- Two additive columns, no RLS/grant changes (table-level grants + policies
-- from 073 cover new columns):
--
-- 1. equipment_notebook_turns.basis — WHICH evidentiary state the served
--    answer was under (spec §1.3 ladder). Fixes #3387: the amber "General
--    guidance" label was stream-only, so after reload a general answer was
--    indistinguishable from a grounded one. NULL = no basis claim (refusals,
--    safety stops, errors, and every pre-084 row). Values mirror
--    lib/notebook-chat-types.ts EvidenceBasis exactly.
--
-- 2. equipment_notebook_sources.origin_file_id — the canonical workspace file
--    a MATERIALIZED doc was derived from (today: the nameplate photograph
--    behind the generated nameplate text doc). This is the structural half of
--    "citation [1] and the attachment are two views of the same object": the
--    viewer shows the actual photograph, with the derived text as source
--    detail. NULL for ordinary uploads (the doc's own file IS the original).
--    FK ON DELETE SET NULL: deleting the photo must not strand the source row
--    or block the delete — the doc simply loses its photo affordance.

BEGIN;

ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS basis TEXT NULL
    CHECK (basis IS NULL OR basis IN
      ('general_reasoning',
       'identified_component',
       'oem_documentation',
       'workspace_evidence',
       'machine_history',
       'live_machine_evidence'));

ALTER TABLE equipment_notebook_sources
  ADD COLUMN IF NOT EXISTS origin_file_id UUID NULL
    REFERENCES namespace_direct_uploads(id) ON DELETE SET NULL;

COMMENT ON COLUMN equipment_notebook_turns.basis IS
  'Evidence-ladder basis of the SERVED answer (spec 1.3); NULL = no claim (refusal/safety/error/pre-084).';
COMMENT ON COLUMN equipment_notebook_sources.origin_file_id IS
  'Canonical workspace file a materialized doc derives from (e.g. the nameplate photo behind nameplate-<id>.txt).';

COMMIT;

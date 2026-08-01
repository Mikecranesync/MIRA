-- Migration 071: decision_traces gains the context manifest (Unification G6).
--
-- WHY (ADR-0033 / PRD goal G6, "audit row = prompt row"): until now the audit
-- row was *re-derived* at trace time from whatever the engine happened to have
-- on hand (uns_context, RAG sources), while the prompt was built from a
-- separate, untyped assembly. The two could silently disagree — and that
-- divergence is precisely what G6 exists to close.
--
-- WS1 wires `materialized_evidence/context_contract.py` into the serving path:
-- the engine now assembles ONE `TechnicianContext`, renders the prompt block
-- from it, and records that same object here. `context_manifest` is the
-- serialized contract (`TechnicianContext.to_dict()`); `context_manifest_sha256`
-- is a sha256 over its canonical JSON so two rows can be compared — and a
-- prompt/trace divergence detected — without parsing the payload.
--
-- ADDITIVE ONLY. Both columns are nullable with no default beyond NULL:
--   * every historical row keeps NULL, which reads correctly as "written before
--     the contract existed" — NOT as an empty context;
--   * turns taken with MIRA_CONTEXT_CONTRACT off also write NULL, so the column
--     doubles as the adoption counter for the flag's promotion decision.
--
-- NO new table, registry, or approval ladder (materialized-evidence rule 15):
-- this extends the ONE existing audit row rather than forking a second one.
--
-- tenant_id is untouched (TEXT since migration 070 — bot surfaces produce slug
-- tenants; see #3003). No policy or index is dropped, so migration 071 needs
-- none of the ALTER-ordering dance of rule §4.

BEGIN;

ALTER TABLE decision_traces
    ADD COLUMN IF NOT EXISTS context_manifest JSONB;

ALTER TABLE decision_traces
    ADD COLUMN IF NOT EXISTS context_manifest_sha256 TEXT;

COMMENT ON COLUMN decision_traces.context_manifest IS
    'Serialized TechnicianContext (materialized_evidence.context_contract) the '
    'prompt block for this turn was rendered from. NULL = turn predates the '
    'contract, or MIRA_CONTEXT_CONTRACT was off.';

COMMENT ON COLUMN decision_traces.context_manifest_sha256 IS
    'sha256 over the canonical JSON of context_manifest — lets prompt/trace '
    'divergence be detected without parsing the payload (PRD G6).';

-- Adoption / divergence sweep: "traces that carry a contract manifest".
-- Partial index — the vast majority of historical rows are NULL and should not
-- be carried in it.
CREATE INDEX IF NOT EXISTS decision_traces_context_manifest_idx
    ON decision_traces (tenant_id, ts DESC)
    WHERE context_manifest IS NOT NULL;

COMMIT;

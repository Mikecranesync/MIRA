# Discovery — CV-200 interlock DB integration (propose → approve → recall → answer)

Issue #2396. The **next layer** after the replay proof (PR #2395, merged): prove the
**database-backed lifecycle** end-to-end, still **default-off** and **disconnected from live
Ask MIRA / Perspective**. Layer order (do not skip): **replay proof ✅ → DB proof (this) → live
engine turn → Perspective/Ask MIRA UI**.

Branch `feat/cv200-interlock-db-integration` off `origin/main` (`331f2432`, VERSION 3.55.1 — includes
the merged replay demo).

## Key finding
There is **no pre-existing** DB-backed interlock round-trip test (the replay docstring's "proven
separately" was aspirational). This issue is **net-new** — a `DATABASE_URL`-gated integration test.

## What the recall path requires (from the real code — `interlock_context._RECALL_SQL`)
- `kg_relationships r`: `source_id`, `target_id`, `relationship_type` ∈ (`USED_IN_LOGIC`,`CAUSES`),
  `confidence`, `evidence_summary`, `tenant_id`, `approval_state` (`'verified'` gate),
  `relationship_proposal_id`.
- `kg_entities se/te`: `id`, `name`, `uns_path` (ltree; filter `<@ subtree`).
- `relationship_evidence ev`: `proposal_id`, `evidence_type`, `page_or_location`, `excerpt`.
- Recall/answer entry points (reuse UNCHANGED): `recall_interlocks(cur, tenant, subtree,
  include_unapproved=False)`, `build_interlock_answer(recalled, live, asset)`.

## Approve mechanics (reuse — ADR-0017)
`mira-bots/shared/proposal_transition.py`:
`apply_kg_approval(cur, *, table, row_id, trigger, tenant_id)` — `trigger="accept"` moves
`kg_approval_state proposed → verified` (and the proposal row `proposed → verified`). Direct
`UPDATE … SET approval_state` is a bug; go through this helper.

## Schema source of truth (read the DDL before writing the test)
- `docs/migrations/004_kg_entities.sql`, `005_kg_relationships.sql`
- `mira-hub/db/migrations/018_relationship_proposals.sql`, `029_kg_approval_state.sql`,
  `025_kg_entities_natural_key.sql`, `026_kg_entities_dedupe_and_constraint.sql`
- Confirm exact column names / CHECK vocab / ltree + FK linkage (`relationship_proposal_id` →
  `relationship_proposals.id`; `relationship_evidence.proposal_id`) against these — do NOT assume.

## Bootstrap pattern to follow
`tests/integration/test_phase0_schema.py`, `tests/integration/test_rls_tag_trace_tables.py` show the
repo's `skipif(not DATABASE_URL)` + connection + ephemeral-setup style. **Decision to make:** create
the minimal kg tables inline in the test (ephemeral, self-contained, like other integration tests) vs.
apply real migrations to a staging Neon branch. Prefer the lightest that faithfully exercises
`recall_interlocks` + `apply_kg_approval`.

## Plan (smallest safe)
1. `tests/integration/test_cv200_interlock_db_roundtrip.py`, `skipif(not os.getenv("DATABASE_URL"))`.
2. Bootstrap kg schema (per decision above); insert CV-200 `kg_entities` (signals) under UNS
   `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`.
3. **Propose** the interlock edges (`relationship_proposals` + `relationship_evidence` with the
   `plc_rung` citation; `kg_relationships` rows `approval_state='proposed'`), including 1–2 that stay
   proposed.
4. **Approve** the interlock chain via `apply_kg_approval(..., trigger="accept")` → `verified`.
5. **Recall** via `recall_interlocks(cur, tenant, subtree)` → only the verified edges.
6. **Answer** via `build_interlock_answer` (photoeye-blocked live state) → grounded, `plc_rung`
   citations survive the round-trip.
7. Assert: proposed edges absent from normal recall; evidence/citations present; teardown.

## Tests / acceptance (from the issue)
Skips cleanly w/o `DATABASE_URL`; passes vs staging Neon w/ it; approved CV-200 edges recalled;
proposed edges not used in normal answer context; evidence/citations survive the round-trip;
`MIRA_INTERLOCK_CONTEXT_ENABLED` stays default-off.

## Out of scope (this issue)
Perspective / Ignition / live Ask-MIRA wiring; any live engine turn; PLC writes; prod DB (staging
only, never prod psql — `docs/environments.md`); changing the flag default.

## Status: branch created + discovery done. Next pass builds the gated test (verify skip-path locally;
green-vs-staging proven in CI).

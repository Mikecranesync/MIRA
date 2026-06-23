# Phase 5 — DB Migration Plan (minimal)

**Principle: prefer the fewest migrations. Reuse tables; do not fork.** Grounded to the schema deep dives. 2026-06-23. Migration head **056**; next free prefix **057** (duplicate-prefix pairs at 033/045/048/055 are cosmetic — do NOT renumber, `mira-hub-migrations.md §7`). Re-confirm the tail against `origin/main` before numbering (`session-discipline.md §1`).

## Evaluation of each candidate

| Candidate | Needed? | Decision |
|---|---|---|
| **`needs_review` on `ai_suggestions.status`** | **YES (1 migration)** | The CHECK is `('pending','accepted','rejected','deferred','superseded')` (mig 027:86) — `needs_review` is absent. The spine emits it for inferred components/feeds/cells. **DROP + ADD CONSTRAINT** (not `ADD COLUMN`). See below. |
| **Failure-mode home (table or suggestion_type)** | **NO (default)** | Keep failure modes in `component_templates.common_failure_modes` (JSONB) + the `HAS_FAILURE_MODE` edge type. No `failure_modes` table, no `fault_code` suggestion_type — adding either forks the model. Revisit only if per-asset citable failure-mode rows become a product requirement. |
| **Evidence-graph storage** | **NO** | Do not persist the graph. It's a transient view over `decision_traces` (`tag_evidence`/`manual_evidence`/`kg_evidence`) + `kg_entities`/`relationship_evidence`. A new evidence table would worsen the already-3-home scatter. |
| **Answer-card storage** | **YES (1 column)** | One new `explanation JSONB DEFAULT '{}'` column on `decision_traces` (mirrors the 032 JSONB-evidence pattern). Holds most-likely-cause + ranked causes + evidence for/against + technician checks. **This is the only answer-card migration** — the "parked" fields were comment-only, not columns (correction to 4.5). |
| **Decision-trace extension** | covered above | = the `explanation` column. `confidence` already added (mig 055); `decision_trace_feedback` (human review) already exists (mig 055). |
| **FactoryModel persistence tables** | **NO** | Assets→`kg_entities`, signals→`tag_entities`, staged via `ai_suggestions` — all exist. No new tables. |
| **Relationship ingestion** | **NO new table** | `relationship_proposals` + `relationship_evidence` exist; the gap is a *writer* (post-approval resolver), not schema. |

**Net: two migrations across the whole Phase 5, in separate PRs.** No new tables.

## Migration 1 (PR-1, Hub writer): `057_ai_suggestions_needs_review.sql`

```sql
BEGIN;
ALTER TABLE ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_status_check;
ALTER TABLE ai_suggestions ADD CONSTRAINT ai_suggestions_status_check
  CHECK (status IN ('pending','accepted','rejected','deferred','superseded','needs_review'));
COMMIT;
```
- **Idempotent** (`DROP … IF EXISTS`), single transaction (`apply-migrations.yml` may re-run).
- `ai_suggestions.tenant_id` is **UUID**; the RLS policy already casts `::UUID` (mig 027:140). A CHECK-only change does NOT touch the policy → **no drop-policy / drop-GiST dance** (rule §4 is for `ALTER COLUMN TYPE` only).
- **ADR-0017 follow-through:** if `needs_review` becomes a *reachable transition target* (not just an initial insert value), add the trigger to `proposal-transition.ts:40` (`PROPOSAL_TRANSITIONS`) + the Python `proposal_transition.py`, and extend `tests/canary/test_proposal_canary.py` — else the nightly **Proposal State Canary** can drift red. For PR-1 the writer only *inserts* `needs_review`/`pending` rows (no transition), so this is optional but should be noted.

## Migration 2 (PR-3, MIRA answer card): `0NN_decision_traces_explanation.sql`

```sql
ALTER TABLE decision_traces ADD COLUMN IF NOT EXISTS explanation JSONB NOT NULL DEFAULT '{}'::jsonb;
```
- `ADD COLUMN IF NOT EXISTS` (idempotent); no constraint, no index needed initially.
- Then `GET /api/decision-trace/[id]` adds `explanation` to its SELECT.

## Process + guardrails

- **dev → staging → prod** via `apply-migrations.yml` (`dry-run` then `apply`); `migration-verify.yml` auto-applies the PR's migration to **staging Neon** + runs `tests/integration/test_phase0_schema.py` (the gate that catches RLS/grant/constraint mistakes).
- **CI / Migration Order Check** (`db/check-migration-order.mjs`): an `ALTER` on the existing `ai_suggestions` has no ordering risk; only a *new table* needs a DEP_MAP edit.
- **tenant_id discipline:** use a **UUID** tenant in any fixture (slug tenants 401; `STAGING_TENANT_ID` UUID is what `migration-verify.yml`/`staging-gate.yml` use). `mira-hub-migrations.md §1, §6`.
- Never `psql` prod from a session; never seed prod first.

**Bottom line: two tiny migrations (one CHECK swap, one JSONB column), both idempotent, both single-table, no new tables, no RLS/GiST surgery.**

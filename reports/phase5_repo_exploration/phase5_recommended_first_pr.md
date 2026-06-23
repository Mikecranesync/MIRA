# Phase 5 — Recommended First Integration PR

**The smallest safe PR that proves the spine is FactoryLM data, not a parallel store.** Verified from repo evidence (the `/api/contextualization/import` header even says *"P5 migrates the offline client onto the contract"*). 2026-06-23.

## What it does

**Persist the Phase 1 `factory_context.FactoryModel` (assets + signals) into the existing `ai_suggestions` queue**, mirroring `plc-proposals.ts`, so the synthetic factory appears in `/knowledge/suggestions` + `/contextualization/[id]` and becomes real `kg_entities`/`tag_entities` on human approval. Plus the one CHECK migration adding `needs_review`.

**Scope boundary:** assets + signals only. **Relationships, fault-codes, the answer-card `explanation`, MQTT, and Ignition are explicitly out** (later PRs). No engine change. No new page. No new table.

## Files to modify / add

| File | Change | Template |
|---|---|---|
| `mira-hub/src/lib/factory-model-proposals.ts` | **NEW** — pure `factoryModelToSuggestions(model)` + `insertFactoryModelSuggestions(tenantId, rows)` (verbatim copy of `insertPlcSuggestions`) | `mira-hub/src/lib/plc-proposals.ts:66,135` |
| `mira-hub/src/app/api/connectors/simlab/import/route.ts` (or `/api/factory-model/import`) | **NEW** — `sessionOr401()` → parse FactoryModel JSON → call the lib | `mira-hub/src/app/api/connectors/plc/import/route.ts:19` |
| `mira-hub/db/migrations/057_ai_suggestions_needs_review.sql` | **NEW** — DROP/ADD CHECK adding `needs_review` (idempotent, single txn) | `db_migration_plan.md` §Migration 1 |
| `mira-hub/src/lib/factory-model-proposals.test.ts` | **NEW** — vitest unit (mock client) | `mira-hub/src/lib/proposal-transition.test.ts:43` |
| `mira-hub/src/app/api/connectors/simlab/import/__tests__/route.test.ts` | **NEW** — route unit (201/400/401, tenant scope) | `api/suggestions/[id]/decide/__tests__/route.test.ts` |
| `mira-hub/src/.../factory-model-import.integration.test.ts` | **NEW** — real-PG round-trip (named `*.integration.test.ts` so CI skips it; runs locally) | `api/contextualization/import/import.integration.test.ts` |
| `tests/integration/test_phase0_schema.py` | **EXTEND** — assert `needs_review` accepted under RLS as `factorylm_app` with a **UUID** tenant | existing file |
| `/VERSION` **and** `mira-hub/package.json` | **bump BOTH** — root `/VERSION` (required, `docs/versioning.md`) **and** the hub minor (`mira-hub/AGENTS.md` — "schema migration bumps the minor"). **Verified lockfile-safe:** `mira-hub/bun.lock` workspace root has `name` only, no `version` field, so a version-only bump does not break `--frozen-lockfile`. | `mira-hub/AGENTS.md` |

**Do NOT touch:** `suggestion-accept.ts` (accept path already handles `kg_entity`/`tag_mapping`), the `/knowledge/suggestions` UI, any engine file, any new table.

## The `ai_suggestions` row shape to emit (copy from `plc-proposals.ts`)

```
INSERT INTO ai_suggestions
  (tenant_id, suggestion_type, extracted_data, confidence, status, risk_level, proposed_by, title, body)
```
- `suggestion_type`: `"kg_entity"` (per asset) | `"tag_mapping"` (per signal)
- `extracted_data`: asset → `{entity_type:"equipment", name, uns_path, …}`; signal → `{tag, uns_path, signal, data_type, …}` (the keys `suggestion-accept.ts:62-64,116-118` reads)
- `confidence`: `0.85` constant (FactoryModel is deterministic ground truth)
- `status`: `'pending'` (or `'needs_review'` for spine-flagged inferred items)
- `risk_level`: `'low'` (`'medium'` for `needs_review`)
- `proposed_by`: `'import:factory_model'`

## Tests to add (and which gate runs them)

- **vitest unit** (Hub Unit Tests, `ci.yml:203`): writer mapping + route — mock the query client, assert the right INSERTs / `suggestion_type` / `extracted_data` / `confidence`.
- **Python integration** (Migration Verify, staging Neon, `migration-verify.yml`): `needs_review` accepted under RLS as `factorylm_app` with a UUID tenant. **This is the DB-backed coverage that runs in CI** (vitest `*.integration.test.ts` is excluded from CI — no `TEST_DATABASE_URL` there; run it locally).

## Gates this PR must pass

Version Gate (bump `/VERSION`) · CI Migration Order · Lint/ruff/pyright · Hub Unit Tests (vitest) · **Migration Verify** (the real catch for the constraint) · Staging Gate · Smoke · **Hub E2E** (runs because `mira-hub/**` changed — keep command-center green) · KG Write Guard (fine — the writer inserts `ai_suggestions`, not `kg_relationships`) · License/Security.

## Risks

1. **Phantom `Hub E2E` required check** → merge needs `gh pr merge --admin` (known branch-protection misalignment, `project_branch_protection_phantom_check`). A stuck `Hub E2E "Expected"` is **not your bug** — but the *executed* command-center spec is real signal here.
2. **Version bumps (corrected from a stale memory):** `mira-hub/AGENTS.md` requires bumping **both** root `/VERSION` and `mira-hub/package.json` (hub minor) for a schema-migration PR. A prior memory (`feedback_mira_hub_pkg_version_frozen_lockfile`) warned "never bump `package.json` — breaks `--frozen-lockfile`"; **that is not true for the current lockfile** — `mira-hub/bun.lock` (lockfileVersion 1) records the workspace root with `name` only and **no `version`**, so a version-only bump leaves `bun.lock` unchanged and `bun install --frozen-lockfile` stays green (runs in Hub Unit Tests / Hub E2E / Smoke). After bumping, run `bun install` and confirm `bun.lock` is unchanged before pushing. (Only a bump that *also* changes dependencies would touch the lockfile — this PR adds none.)
3. **CHECK-constraint migration** is the real risk surface (not the writer) — make it idempotent (`DROP CONSTRAINT IF EXISTS`); Migration Verify applies it to staging and catches a malformed constraint.
4. **tenant_id UUID trap** — use a UUID tenant in fixtures (slug `'mike'` 401s and tests an unreachable path). `mira-hub-migrations.md §1,§6`.
5. **ADR-0017** — the writer only *inserts* rows; any *status transition* must go through `applyHubProposalTransition` (raw `UPDATE … SET status` is a flagged bug + can drift the Proposal State Canary).
6. **Staging Gate** is LLM-graded and can flap — re-run before assuming the writer caused a red.

## Rollback plan

- **Code:** revert the PR (new files only + a `/VERSION` bump → clean revert; no behavior change to existing routes).
- **Migration:** the CHECK swap is additive (adds a permitted value) — rollback = a follow-up migration restoring the 5-value CHECK **only after** confirming no row holds `needs_review` (`UPDATE … SET status='pending' WHERE status='needs_review'` first). Since `apply-migrations.yml` is gated dev→staging→prod with dry-run, prod never sees it until staging is green.
- **Data:** rows written are `status='pending'`/`needs_review` proposals — harmless until a human approves; un-approved proposals can be bulk-rejected.

## Acceptance criteria

1. `POST /api/connectors/simlab/import` with a FactoryModel JSON returns 201 and inserts N `ai_suggestions` rows (assets as `kg_entity`, signals as `tag_mapping`), tenant-scoped.
2. The rows appear in **`/knowledge/suggestions`** with confidence + Verify/Reject.
3. Verifying a `kg_entity` row creates a `kg_entities` (`approval_state='verified'`) row; verifying a `tag_mapping` creates a `tag_entities` row — **via the unchanged `decideSuggestion` path**.
4. `needs_review` is an accepted `ai_suggestions.status` value (Migration Verify green).
5. All gates green (merge `--admin` per the phantom check); **both** `/VERSION` and `mira-hub/package.json` bumped; `bun.lock` unchanged.
6. **No new table, no new page, no engine change, no licensed data.**

## Why this PR, not another

It attacks the **highest** duplication risk (the data-model/queue fork) with the **lowest** blast radius (new files + one additive CHECK), reuses the proven `plc-proposals` template, and changes **zero** existing behavior. Once it lands, the synthetic factory lives in the one real queue — and PR-2 (relationships) and PR-3 (answer-card `explanation`) build on a spine that already speaks FactoryLM.

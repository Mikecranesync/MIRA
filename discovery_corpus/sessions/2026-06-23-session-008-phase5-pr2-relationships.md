# Session 008 — Phase 5 PR-2: relationships + needs_review integration

**Date:** 2026-06-23
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 5 PR-2)
**Class of work:** real Hub integration (TypeScript) — relationship proposals + the needs_review decide path

> Continue merging the spine into the existing FactoryLM Hub. Reuse existing structures; no second
> queue, no second MIRA, no new tables unless unavoidable. Synthetic data only.

---

## 1. Question being answered

How do Phase 1 FactoryModel relationships (contains / feeds) enter the EXISTING approval workflow and
persist into the existing entity/relationship system, without parallel concepts? And what is the
smallest ADR-0017-respecting change to let `needs_review` flow through the existing decide path?

## 2. Files inspected (existing Hub, read-only)

- `mira-hub/db/migrations/018_relationship_proposals.sql` — the relationship_proposals + relationship_evidence schema.
- `mira-hub/src/lib/knowledge-graph/proposals-writer.ts` — `upsertInferredProposal` + `CANONICAL_PROPOSAL_RELATIONSHIP_TYPES` + `mapToCanonicalEdge`.
- `mira-hub/src/lib/proposal-transition.ts` — `PROPOSAL_TRANSITIONS` + `applyHubProposalTransition`.
- `mira-hub/src/app/api/proposals/[id]/decide/route.ts` — the kg_edge decide path.
- `mira-hub/src/lib/suggestion-accept.ts` — `decideSuggestion` (the non-edge path + the needs_review guard).
- `mira-hub/src/lib/tenant-context.ts` — `withTenantContext` (PoolClient, RLS).
- `mira-hub/src/lib/__tests__/suggestion-accept.test.ts` — the decideSuggestion mock pattern.

## 3. Assumptions tested

| # | Assumption | Result |
|---|---|---|
| A1 | A relationship_proposals row can be created by name/uns_path. | **FAILED** → `source_entity_id`/`target_entity_id` are NOT-NULL UUIDs (mig 018:19,21). Relationships are necessarily POST-APPROVAL (entities must exist). |
| A2 | I must write a new relationship writer. | **FAILED** → `upsertInferredProposal` (proposals-writer.ts:117) is the canonical writer — idempotent, writes relationship_proposals (status='proposed', requires_human_review=true) + 1..N relationship_evidence. Reuse it. |
| A3 | needs_review needs changes across the whole decide flow. | **FAILED** → `applyHubProposalTransition` has NO from-state guard (it SETs the target status). The only guard is `decideSuggestion:173` (`status !== "pending"`). One-line change. The EDGE path already allows needs_review (decide route:141). |
| A4 | The spine's "contains" (line→asset) is directly demonstrable. | **REFINED** → PR-1 created entities for ASSETS only; line/area aren't entities, so line→asset HAS_COMPONENT resolves UNRESOLVED. The demonstrable containment is asset→signal **HAS_SIGNAL** (the "Conveyor01 contains Photoeye01" case) — both endpoints exist after PR-1. |
| A5 | Approving a relationship proposal persists it. | **CONFIRMED** → `/api/proposals/[id]/decide` verify → applyHubProposalTransition + INSERT kg_relationships (approval_state='verified', source/target/type, relationship_proposal_id) (decide route:159-203). Unchanged path. |

## 4. Failed assumptions / load-bearing facts

- **relationship_proposals requires existing entity UUIDs** → the relationship writer is a POST-APPROVAL resolver (uns_path → kg_entities/tag_entities id where approval_state='verified'), run after PR-1's suggestions are approved.
- **`needs_review` is one line** in `decideSuggestion` — the transition helper is from-state-agnostic, so no ADR-0017 mapping change is needed (the writer only *inserts*; the decide path *transitions* through the helper).
- **"contains" maps cleanly to HAS_SIGNAL** for asset→signal (the spine has no component sublayer in Phase 1; HAS_COMPONENT awaits Phase 2 components). Canonical vocab (mig 018 CHECK): feeds→UPSTREAM_OF, contains→HAS_COMPONENT, asset-has-signal→HAS_SIGNAL.

## 5. Decisions made

- Reuse `upsertInferredProposal` + the existing decide route + `/proposals` queue + ADR-0017 helper. **Zero changes to the decide path; zero new tables; zero new queue.**
- New `factory-model-relationships.ts`: a pure `factoryModelToRelationshipSpecs` (feeds→UPSTREAM_OF, contains→HAS_COMPONENT, derived asset→signal→HAS_SIGNAL) + `writeRelationshipProposals` (resolve endpoints → upsertInferredProposal; unresolved reported). Thin route mirrors PR-1.
- needs_review: one-line guard widen in `decideSuggestion` (`pending` OR `needs_review`).
- Evidence: `evidence_type='manifest'` (valid in the relationship_evidence CHECK) — the import manifest.

## 6. Reusable findings / integration risks

Reusable: the canonical relationship pipeline = `upsertInferredProposal` → `/proposals` union → `/api/proposals/[id]/decide` (verify) → `kg_relationships`. Any future relationship source (Phase 2 components, CMMS) plugs in here. Risk: a relationship writer that bypasses `upsertInferredProposal` (raw INSERT) or `applyHubProposalTransition` (raw status UPDATE) drifts the ADR-0017 proposal-state canary — avoided. Risk: resolver must filter `approval_state='verified'` (only real entities), else it would reference non-existent ids.

## 7. Validation (local)

Transform on the real `phase1_context_model.json`: 11 model relationships → 36 specs (2 feeds→UPSTREAM_OF,
9 contains→HAS_COMPONENT, 25 derived HAS_SIGNAL). At runtime: feeds (asset→asset) + HAS_SIGNAL
(asset→signal) resolve against PR-1's entities; line→asset HAS_COMPONENT reports unresolved. Hub vitest +
tsc run in CI (no bun/Neon locally).

## 8. Tests / fixtures added

`factory-model-relationships.test.ts` (spec mapping + resolver/writer with mock client + mocked
upsertInferredProposal) and two new `decideSuggestion` cases (needs_review verify + reject) in the
existing `suggestion-accept.test.ts`. No new fixtures; synthetic inline. No licensed data; no new tables.

# ADR-0017: Proposal state-machine mapping — one logical machine, three table projections

## Status
Accepted — 2026-05-24

**Related:** ADR-0013 (Namespace-builder schema canonicalization), ADR-0014 (`ai_suggestions` as broad work queue), `CONTEXT.md` (cross-cutting glossary — Proposals & suggestions).
**Implements:** the cross-table status contract implied by the `AISuggestion` → `RelationshipProposal` pointer pattern.

---

## Context

The namespace-builder product surface writes status to three different tables, each with its own CHECK-constrained enum:

| Table | Status enum | Reader |
|---|---|---|
| `ai_suggestions.status` | `pending, accepted, rejected, deferred, superseded` | Hub `/proposals` |
| `relationship_proposals.status` | `proposed, reviewed, verified, rejected, deprecated, contradicted` | Engine promotion job |
| `kg_entities.approval_state` / `kg_relationships.approval_state` | `proposed, verified, rejected, needs_review` | Engine diagnostic path |

`ai_suggestions` rows of type `kg_edge` carry a pointer (`payload.relationship_proposal_id`) at a `relationship_proposals` row, which in turn points at `kg_relationships` for verified edges. Three tables, three vocabularies, zero overlap except `rejected`. ADR-0013's May 19 update is the prior cautionary tale: a *column-name* divergence between two migration lineages produced silent 500s for months. A *status-value* divergence has the same blast radius if a writer emits a value a reader doesn't recognize.

The plan-level fork: should the three enums be collapsed into one, or kept distinct with an explicit mapping?

## Decision

**Keep the three enums distinct. Document the mapping. Centralize the writes.**

Each enum exists because its table answers a different question:

- **`ai_suggestions.status`** — *what's the human's decision?* (Domain: Hub UI vocabulary, queue lifecycle including `deferred` and `superseded` which the engine never sees.)
- **`relationship_proposals.status`** — *what's the edge's evidence verdict?* (Domain: edge-specific catalog, includes `contradicted` and `deprecated` which only apply to edges.)
- **`kg_*.approval_state`** — *what does the engine read?* (Domain: hot-path filter, includes `needs_review` which is engine-internal.)

Collapsing into one enum forces every table to carry vocabulary it doesn't need. Instead, the canonical mapping is:

| Trigger | `ai_suggestions` | `relationship_proposals` (kg_edge only) | `kg_*.approval_state` |
|---|---|---|---|
| New LLM proposal lands | `pending` | `proposed` | `proposed` (entity) / no row (edge) |
| Admin accepts on Hub | `accepted` | `verified` | `verified` (write/update kg_* row) |
| Admin rejects on Hub | `rejected` | `rejected` | `rejected` |
| Admin punts ("ask me later") | `deferred` | unchanged | unchanged |
| Newer proposal replaces this one | `superseded` | `deprecated` | unchanged |
| Engine job finds contradicting evidence | back to `pending` (with reason) | `contradicted` | verified → `needs_review` |
| Engine flags edge for human re-look | `pending` (re-queued) | `reviewed` | `needs_review` |

## Enforcement

1. **Single helper per side.** Status transitions on these tables go through:
   - Hub-side (TypeScript): `mira-hub/lib/proposal-transition.ts` — wraps every `UPDATE … SET status = …` on `ai_suggestions` and `relationship_proposals`.
   - Engine-side (Python): `mira_bots/shared/proposal_transition.py` — wraps every write to `kg_*.approval_state` and any engine-triggered update on `relationship_proposals`.

   Helpers don't exist yet; they get created when the first transition site lands in Phase 1. Once they exist, direct `UPDATE` statements that bypass them are bugs.

2. **CLAUDE.md guardrail.** `.claude/CLAUDE.md` § "Knowledge graph proposals" points at this ADR. Reviewers reject PRs that write status without going through the helpers.

3. **CI canary (Phase 1 task).** A nightly check fails CI if any pair is observably drifted:
   - `ai_suggestions.status='accepted'` AND `payload.relationship_proposal_id IS NOT NULL` AND the paired `relationship_proposals.status ≠ 'verified'`
   - `kg_relationships.approval_state='verified'` AND no `relationship_proposals.status='verified'` row at the matching (source_id, target_id, relationship_type)

   Land as `tests/canary/proposal_state_drift.sql` + a workflow that emails on non-zero rows.

## Why this is right

- **Each enum is right for its question.** Forcing `deferred` into `relationship_proposals` would muddy edge-evidence semantics; forcing `contradicted` into `ai_suggestions` would muddy the Hub queue.
- **The mapping is what's load-bearing**, and ADRs are exactly the place for load-bearing mappings that aren't obvious from any single table's schema.
- **Centralizing writes is cheaper than enum unification.** A helper per side is two files. Enum unification is migrations across three tables + every writer + every reader.
- **Drift is observable from the database.** The canary catches it without needing extra infrastructure.

## Consequences

- The Phase 1 schema sub-task adds the two helper files (TypeScript + Python) and the canary SQL. No new tables; no migration changes.
- Future PRs that introduce a new `suggestion_type` (beyond the six in ADR-0014) must extend the mapping table here as part of the same PR.
- The "engine reads what humans verified" invariant (ADR-0013) is preserved: the engine continues to read only `approval_state='verified'`; this ADR just makes explicit how that state gets there.
- Any future migration to unify the enums (rejected today) starts by deprecating values one-by-one, with the canary as the contract test.

## What was NOT decided here

- The exact column shape of the `accepted_by` / `accepted_at` audit fields on `ai_suggestions` (referenced implicitly by "Admin accepts on Hub"). Deferred to the Hub UI sub-task that wires the Accept button.
- Whether `superseded` rows are visible on `/proposals` under a "Show history" toggle, or hidden by default. Product decision; deferred to the Hub UI sub-task.
- The contradicted-evidence detection job itself (which engine path produces a `relationship_proposals.status='contradicted'` write). Deferred to the engine task that owns periodic re-evaluation.

# Platform Alignment — Approval Workflow (Audit Area 2)

**Phase 4.5 audit, read-only. 2026-06-23.**
**Question:** can the existing Hub approve the spine's suggested assets / relationships / signal roles / failure modes / evidence links, or is the spine a separate approval concept?

**Verdict:** **same logical machine, different projection.** The spine's `{suggested, approved, rejected, needs_review}` equals `kg_*.approval_state` **verbatim** (modulo `proposed→suggested`, `verified→approved` renames). Assets + relationships are approvable in the Hub **today**. Signal-role and evidence-link are sub-fields (PARTIAL). **Failure mode is entirely MISSING** (no `suggestion_type`, no table, no decide path).

## The existing approval state machine (ADR-0017 — one machine, three projections)

| Trigger | `ai_suggestions.status` | `relationship_proposals.status` | `kg_*.approval_state` | Who |
|---|---|---|---|---|
| New LLM proposal | `pending` | `proposed` | `proposed` | **machine** |
| Admin accepts | `accepted` | `verified` | `verified` | **human** |
| Admin rejects | `rejected` | `rejected` | `rejected` | **human** |
| Admin defers | `deferred` | — | — | human |
| Superseded | `superseded` | `deprecated` | — | machine |
| Engine finds contradiction | → `pending` | `contradicted` | `verified→needs_review` | machine |
| Engine flags for re-look | `pending` | `reviewed` | `needs_review` | machine |

- Canonical writers (no raw `UPDATE … SET status`): Hub `mira-hub/src/lib/proposal-transition.ts` (`applyHubProposalTransition`) owns `ai_suggestions`+`relationship_proposals`; engine `mira-bots/shared/proposal_transition.py` (`apply_kg_approval`) owns `kg_*.approval_state`.
- **Machine emits only `pending`/`proposed`/`needs_review`; the two terminal promotions are human-only admin actions.** This matches the spine's "machine never auto-approves" exactly.

## Existing approve/reject API + UI

- `POST /api/proposals/[id]/decide` — kg_edge (`relationship_proposals` → mirror into `kg_relationships`) + inline `tag_mapping`. Decidable from `proposed|reviewed|needs_review`.
- `POST /api/suggestions/[id]/decide` (`suggestion-accept.ts`) — non-edge accept: `kg_entity`→creates verified `kg_entities` row; `tag_mapping`→creates verified `tag_entities` row; `component_profile`/`uns_confirmation`/`namespace_move` are status-only. Decidable from `pending`.
- `GET /api/proposals` unions `relationship_proposals` (kg_edge) + `ai_suggestions` (5 non-edge types).
- **UI:** `/proposals` → `/knowledge/suggestions` (Verify/Reject buttons only — **no defer/needs_review control**). Parallel surface: asset-agent lifecycle `draft→training→validating→approved→deployed` (`asset-agent-transition.ts`) — the train-before-deploy gate, a *different* machine.

## Mapping per spine approvable

| Spine approvable | Hub support | suggestion_type | Note |
|---|---|---|---|
| suggested **asset** | **DIRECT** | `kg_entity` | verify → creates verified `kg_entities` row. |
| suggested **relationship** | **DIRECT** | `kg_edge` | verify → `relationship_proposals.verified` + mirror to `kg_relationships`; full `relationship_evidence` chain. |
| suggested **signal role** | PARTIAL | `tag_mapping` | role rides inside the tag_mapping payload; **not its own approvable row/enum**. |
| suggested **failure mode** | **MISSING** | — | no suggestion_type, no table, no decide path. Closest bucket `component_profile` (status-only today). |
| suggested **evidence link** | PARTIAL | (sub-part of kg_edge) | `relationship_evidence` rows are approved *transitively* with the parent edge; no per-evidence decide. |

## The enum gap, precisely

| Spine status | `kg_*.approval_state` | `ai_suggestions.status` | `relationship_proposals.status` |
|---|---|---|---|
| `suggested` | `proposed` ✅ | `pending` ⚠ rename | `proposed` ✅ |
| `approved` | `verified` ⚠ rename | `accepted` ⚠ rename | `verified` ⚠ rename |
| `rejected` | `rejected` ✅ | `rejected` ✅ | `rejected` ✅ |
| `needs_review` | `needs_review` ✅ | **absent ❌** | `reviewed` ⚠ rename |

- The spine's four values live **natively on `kg_*.approval_state`** (only table carrying all four).
- **`ai_suggestions` has no `needs_review`** → the spine's inferred-component / feeds / cell suggestions have nowhere to sit in review on the queue the UI renders (flatten to `pending` today).
- The Hub already maintains a translation table for exactly this divergence: `PROPOSAL_TO_SUGGESTION_STATUS` (`/api/proposals/route.ts`).

## Conclusion

The spine's approval concept is **not parallel — it is the Hub's ADR-0017 machine** (machine-suggests, human-promotes; auto-approve is a documented bug). To integrate: route every spine status change through `proposal-transition.ts` / `proposal_transition.py` (never write status directly), map `suggested→proposed/pending`, `approved→verified/accepted`, and **add `needs_review` to `ai_suggestions`** so the queue can hold the spine's review-grade suggestions. Assets + relationships approve today; **signal-role and evidence-link need to become first-class approvables only if the product wants per-role/per-evidence sign-off; failure-mode needs a `suggestion_type` (+ optional table) — it is the single genuinely-missing approval path.**

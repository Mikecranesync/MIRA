# Hub relationship-writer audit (issue #1721)

**Date:** 2026-06-05 · **Parent:** #1662 · **EPIC:** #1666 · companion to the Python-side `docs/audits/2026-06-04-ingest-edge-write-paths-1662.md` (note: that file lives in the repo root `docs/`; this one is hub-local).

Follow-up to #1716 (Python ingest now proposes). This classifies the **mira-hub TypeScript** writers that touch `kg_relationships` and migrates the first one to propose-by-default.

## Policy (the Iron Rule, stricter than Python)

Per `.claude/skills/managing-the-knowledge-graph` + ADR-0017: **no MIRA-inferred edge is ever written directly to `kg_relationships`.** It lands as a `relationship_proposals` row (via `upsertInferredProposal`); the verified edge is written only on human approval (`proposals/[id]/decide/route.ts`).

Unlike the Python ingest path, the hub has **no `autoverify` escape hatch** for inferred edges — determinism/high-confidence sets *confidence*, never *verified*. The human confirm IS the product. (`MIRA_KG_INGEST_AUTOVERIFY` is a Python-ingest-only migration concession; it does not exist on the hub.)

**Central enforcement (this PR):** `upsertInferredProposal` now guards on `CANONICAL_PROPOSAL_RELATIONSHIP_TYPES` (the `relationship_proposals.relationship_type` CHECK vocabulary, migrations 018→028→032). A non-canonical type is skipped with a warning instead of throwing a CHECK violation that would silently drop the edge.

**Shared vocabulary map (this PR):** `mapToCanonicalEdge(rawType)` (proposals-writer.ts) maps the hub's lowercase `kg_relationships` vocabulary → canonical, returning `{type, flip}` (`flip` = the canonical edge runs the opposite direction, e.g. `caused_by` → `CAUSES` reversed). The TS analogue of Python's `_CANONICAL_RELATION_TYPE`. Unmapped types (`has_work_order`, `controls`, `protects`, `maintained_by`) return null → caller skips. This is the foundation every remaining writer migrates onto.

## Writer classification

| Writer | Class | Status |
|---|---|---|
| `queries.ts::upsertSchematicComponents` | **inferred** (schematic intelligence extracts components + wiring) | ✅ **migrated** (this PR) → proposes via `upsertInferredProposal`. Entity nodes still upserted; edges propose. |
| `proposals/[id]/decide/route.ts` | **safe** | Human-approval verified write — the one legitimate door. Unchanged. |
| `relationship-extractor.ts` (LLM, `confidence ≥ HIGH_CONFIDENCE_THRESHOLD → INSERT`) | **inferred** — the literal "confidence > X → verify" anti-pattern | ✅ **migrated** (this PR) → above-threshold edges propose via `upsertInferredProposal` (predicate mapped through `mapToCanonicalEdge`, incl. `caused_by`→`CAUSES` flip); below-threshold stays triple-only. |
| `extractor.ts::proposeConversationEdge` (conversation extraction) | **inferred** | ✅ **migrated** (#1721 final slice) → mentioned_tag→HAS_TAG, exhibited_fault→HAS_FAILURE_MODE, requires_part→HAS_PART propose via `upsertInferredProposal`. Proposed at a moderate fixed confidence (0.7), not the old auto-verified 1.0. |
| `cmms-sync.ts::proposeCmmsEdge` | **inferred** (mirrors CMMS structural data — still a proposal per Iron Rule) | ✅ **migrated** (#1721 final slice) → located_at→LOCATED_IN, has_work_order→HAS_WORK_ORDER, has_pm→HAS_PM_SCHEDULE propose (conf 0.9, evidence `work_order`/`manifest`). Unblocked by migration 043. |
| `hierarchy-backfill.ts::proposeLocatedIn` | **decision → inferred** | ✅ **migrated** (#1721 final slice) → heuristic location match proposes `equipment LOCATED_IN area/line` (parent_of mapped to LOCATED_IN **flipped**). Dropped the dead `parent_of` existence pre-check (nothing writes parent_of post-migration); dedup now via `upsertInferredProposal`. `if (!dryRun)` guard preserved. |
| `queries.ts::createRelationship` | **dead code** (0 callers in `src/`) | Leave as-is; remove in a follow-up (out of scope here — surgical). |

## Vocabulary note (load-bearing)

Staging ground truth: `kg_relationships` holds a **mix** — lowercase legacy from Python ingest (`has_manual`, `documented_in`, `has_fault_code`, `has_work_order`) + uppercase canonical from hub/schematic paths (`WIRED_TO`, `POWERED_BY`, `MAPS_TO`, `USED_IN_LOGIC`, `CAUSES`, `DRIVES`, `LOCATED_IN`, `HAS_COMPONENT`, `HAS_DOCUMENT`). `relationship_proposals` is **entirely** canonical uppercase (+ `SAME_MODEL_AS`/`CO_FAILED_WITH`/`SIMILAR_TO`).

Implication: schematic edges were already canonical (clean migration, no remap). But `cmms-sync` (`has_work_order`) and `hierarchy-backfill` (`parent_of`) use types **absent from the proposals CHECK** — those migrations are blocked on either a CHECK extension (dev→staging→prod) or a canonical map, and must be sequenced accordingly. `types.ts::RELATIONSHIP_TYPES` (lowercase) is also out of step with the proposals CHECK (uppercase) — reconciling them is a separate cleanup.

## Verification (this PR)

- `vitest` — 4 new tests (`queries-schematic.test.ts`): canonical edge → proposal not `kg_relationships`; non-canonical skipped; missing-endpoint skipped; entities still upserted. 35/35 in the affected suites.
- `eslint` clean on changed files; `tsc` clean on changed files (pre-existing unrelated typecheck errors in `namespace/tree`, `rls-deny`, `command-center-freshness` are not touched here).
- Staging smoke on `factorylm/stg`: `proposals=1 evidence=1 kg_relationships=0`, idempotent, guard skips non-canonical.

## Final slice (2026-06-07) — #1721 closed

All three remaining writers migrated onto the propose path. Migration 043 was applied to staging + prod ahead of this, and the competing PRs (#1030/#1263/#1710/#642) settled with **no file overlap** with the target writers.

**Migrated this slice:**
- `extractor.ts` — `upsertRelationship` → `proposeConversationEdge` (regex pass). `mentioned_tag`/`exhibited_fault`/`requires_part` propose; `relationshipsProposed` added to `ExtractionResult` (back-compat `relationships`=0).
- `cmms-sync.ts` — `upsertRelationship` → `proposeCmmsEdge`. `located_at`/`has_work_order`/`has_pm` propose; `relationshipsProposed` added to `SyncResult` (back-compat `relationships`=0).
- `hierarchy-backfill.ts` — `createParentOf` → `proposeLocatedIn` (`parent_of`→`LOCATED_IN` flipped). Dropped the dead `parent_of` existence pre-check; dedup via `upsertInferredProposal`; `if (!dryRun)` guard preserved; `relationshipsProposed` added (back-compat `relationshipsCreated`=0).

**Behavioral note (flood):** the extractor regex pass now proposes on every mentioned tag/fault/part for every asset-chat turn — a real jump in proposal volume (the hub analogue of the #1716 Python "behavioral flood" note). `upsertInferredProposal` dedup caps repeats, but the `/proposals` queue will see more rows.

**Verification (this slice):**
- `vitest` — 8 new propose tests (`cmms-sync-propose`, `extractor-propose`, `hierarchy-backfill-propose`): each writer proposes (relationship_proposals) and does NOT insert `kg_relationships`; canonical types + flip asserted. 35/35 in affected suites.
- `eslint` + `tsc` clean on changed files (pre-existing unrelated typecheck errors in `namespace/tree`, `rls-deny`, `command-center-freshness` untouched).
- `kg-write-guard` green (8 sites, all allowlisted; the 3 migrated sources pruned, 3 new test files added).
- Staging smoke on `factorylm/stg` (throwaway tenant, real CHECK): confirmed 043 live, all six emitted canonical types accepted — `proposals=6 evidence=6 kg_relationships=0`, idempotent, self-cleaned.

`createRelationship` dead code in `queries.ts` remains out of scope (0 callers; separate surgical follow-up). CI guard = #1722 (merged); canary = #1723 (merged).

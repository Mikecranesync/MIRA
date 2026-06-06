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
| `extractor.ts::upsertRelationship` (conversation extraction, conf 1.0) | **inferred** | ⛔ TODO: propose. |
| `cmms-sync.ts::upsertRelationship` (conf 1.0) | **inferred** (mirrors CMMS structural data — still a proposal per Iron Rule) | ⛔ TODO + **blocker**: emits `has_work_order` (lowercase) which is **not in the proposals CHECK**. Needs a CHECK migration (`HAS_WORK_ORDER`) or a canonical map first. |
| `hierarchy-backfill.ts::createParentOf` | **decision → inferred** | ⛔ TODO + **blocker**: it's a *heuristic* location-string match (`entity_id = $2 OR name = $2`), so it is **inferred, not deliberate structure → must propose**. Blocker: `parent_of` is **not** in the proposals CHECK; map to `LOCATED_IN` (equipment → area/line) or add to the CHECK. Decision recorded: **propose**, not auto-verify. |
| `queries.ts::createRelationship` | **dead code** (0 callers in `src/`) | Leave as-is; remove in a follow-up (out of scope here — surgical). |

## Vocabulary note (load-bearing)

Staging ground truth: `kg_relationships` holds a **mix** — lowercase legacy from Python ingest (`has_manual`, `documented_in`, `has_fault_code`, `has_work_order`) + uppercase canonical from hub/schematic paths (`WIRED_TO`, `POWERED_BY`, `MAPS_TO`, `USED_IN_LOGIC`, `CAUSES`, `DRIVES`, `LOCATED_IN`, `HAS_COMPONENT`, `HAS_DOCUMENT`). `relationship_proposals` is **entirely** canonical uppercase (+ `SAME_MODEL_AS`/`CO_FAILED_WITH`/`SIMILAR_TO`).

Implication: schematic edges were already canonical (clean migration, no remap). But `cmms-sync` (`has_work_order`) and `hierarchy-backfill` (`parent_of`) use types **absent from the proposals CHECK** — those migrations are blocked on either a CHECK extension (dev→staging→prod) or a canonical map, and must be sequenced accordingly. `types.ts::RELATIONSHIP_TYPES` (lowercase) is also out of step with the proposals CHECK (uppercase) — reconciling them is a separate cleanup.

## Verification (this PR)

- `vitest` — 4 new tests (`queries-schematic.test.ts`): canonical edge → proposal not `kg_relationships`; non-canonical skipped; missing-endpoint skipped; entities still upserted. 35/35 in the affected suites.
- `eslint` clean on changed files; `tsc` clean on changed files (pre-existing unrelated typecheck errors in `namespace/tree`, `rls-deny`, `command-center-freshness` are not touched here).
- Staging smoke on `factorylm/stg`: `proposals=1 evidence=1 kg_relationships=0`, idempotent, guard skips non-canonical.

## Remaining for #1721

`relationship-extractor.ts` ✅ migrated. `extractor.ts`, `cmms-sync.ts`, `hierarchy-backfill.ts` remain — now fully **map-ready**:

**Vocabulary decided (migration 043).** The CHECK gains dedicated CMMS/tag types and the map covers every emitted type:
- `has_work_order` → `HAS_WORK_ORDER` (new), `has_pm` → `HAS_PM_SCHEDULE` (new), `mentioned_tag` → `HAS_TAG` (new)
- `parent_of` → `LOCATED_IN` **flipped** (equipment LOCATED_IN area)
- `located_at`→`LOCATED_IN`, `exhibited_fault`→`HAS_FAILURE_MODE`, `requires_part`→`HAS_PART` (existing)

**Ordering constraint:** migration 043 must be applied (dev → staging → prod via `apply-migrations.yml`) **before** the `cmms-sync`/`extractor` writer-migration PRs deploy, or a proposal carrying a new type would fail the prod CHECK. The TS map/CANONICAL set already include the new types, but no migrated writer emits them yet, so landing them ahead of the apply is safe.

The three writer migrations stay deferred until 043 is applied **and** their competing PRs (#1030/#1263/#1710/#642) settle. CI guard for unguarded inserts = #1722 (merged); canary = #1723 (merged).

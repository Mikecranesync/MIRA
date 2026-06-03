# KG Relationship Graph — Phase 2 (Enrich) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the relationship web *dense* by **inferring** two new edge types — `SAME_MODEL_AS` (equipment with identical manufacturer+model) and `CO_FAILED_WITH` (equipment whose work orders co-occur in a time window) — written as **proposals** (low confidence, human-review) through the existing approval machinery, and surfaced as dashed "suggested" edges in `/graph` that a user one-click promotes to solid.

**Architecture:** Pure inference functions (unit-tested, no IO) compute candidate pairs; a writer helper persists them to `relationship_proposals` + `relationship_evidence` idempotently; a worker script wires DB → inference → writer per tenant; the graph endpoint optionally UNIONs proposal edges; the page adds a "Show suggestions" toggle and click-to-promote. This is the industrial analog of Obsidian's **unlinked mentions**: the system proposes connections you haven't made, and you confirm them.

**Tech Stack:** Postgres migration, TypeScript, `pg` + `withTenantContext`, vitest, npm (bun not on PATH), `react-force-graph-2d`.

**Branch:** `feat/kg-graph-enrich` (stacked on `feat/kg-relationship-graph` / PR #1669).

**Grounding facts (verified):**
- `relationship_proposals` keys entities by UUID (`source_entity_id`/`target_entity_id` = `kg_entities.id`). Columns include `confidence` (default 0.5), `status` ('proposed'), `created_by` ('rule' allowed), `risk_level` ('low'), `requires_human_review`, `reasoning`.
- The `relationship_type` CHECK does **not** include the new types → **migration required**.
- `relationship_evidence`: FK `proposal_id`, `evidence_type` allow-list includes `'work_order'`, `'manifest'`, `confidence_contribution ∈ [-1,1]`.
- Promote = `POST /api/proposals/[id]/decide` body `{decision:"verify"}` → updates proposal + upserts `kg_relationships`.
- Equipment props JSONB: `manufacturer`, `model_number`. Work orders: `work_orders(id, equipment_id, created_at, tenant_id)`; equipment↔WO already linked by `has_work_order`.
- Graph endpoint `/api/kg/graph` currently reads only `kg_relationships`; the page already styles `state === "proposed"` thinner/greyer.

---

## File structure

| File | Responsibility |
|---|---|
| `mira-hub/db/migrations/030_inferred_relationship_types.sql` | Extend proposals `relationship_type` CHECK: add `SAME_MODEL_AS`, `CO_FAILED_WITH`, `SIMILAR_TO` |
| `mira-hub/src/lib/knowledge-graph/inference.ts` | Pure: `inferSameModelPairs`, `inferCoFailedPairs` (no IO) |
| `mira-hub/src/lib/knowledge-graph/__tests__/inference.test.ts` | Unit tests for both |
| `mira-hub/src/lib/knowledge-graph/proposals-writer.ts` | `upsertInferredProposal()` — idempotent proposal+evidence insert |
| `mira-hub/scripts/kg-infer-proposals.ts` | Worker: DB → inference → writer, per tenant |
| `mira-hub/src/app/api/kg/graph/route.ts` (modify) | `?includeProposals=true` UNIONs proposal edges, carrying `proposalId` |
| `mira-hub/src/lib/knowledge-graph/graph-view.ts` (modify) | `GraphLink.proposalId?: string`; carry through transform |
| `mira-hub/src/components/kg/GraphCanvas.tsx` (modify) | `onLinkClick`; dashed proposed links |
| `mira-hub/src/app/(hub)/graph/page.tsx` (modify) | "Show suggestions" toggle; click proposed edge → promote |

---

### Task 1: Migration 030 — new proposal relationship types

**Files:** Create `mira-hub/db/migrations/030_inferred_relationship_types.sql`

- [ ] **Step 1: Write the migration** — read `028_drives_relationship_type.sql` first to copy the exact `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT … CHECK (relationship_type IN (...))` pattern, then reproduce the FULL existing allow-list (from migration 018 + 028) and append `'SAME_MODEL_AS'`, `'CO_FAILED_WITH'`, `'SIMILAR_TO'`. Wrap in `BEGIN; … COMMIT;` with a header comment block matching the house style. The constraint name must match the real one (find it: `grep -rn "relationship_type" db/migrations/018_relationship_proposals.sql db/migrations/028_drives_relationship_type.sql`).
- [ ] **Step 2: Verify ordering** — `node db/check-migration-order.mjs` → exit 0. If it requires a `-- Issue:` header, add one matching siblings.
- [ ] **Step 3: Commit** — `git add db/migrations/030_inferred_relationship_types.sql && git commit -m "feat(kg): migration 030 — SAME_MODEL_AS/CO_FAILED_WITH/SIMILAR_TO proposal types"`

Acceptance: the migration drops+recreates the CHECK with the full prior list plus the 3 new values; check-order passes. (Applied to Neon on deploy, not here.)

---

### Task 2: Pure inference — `inferSameModelPairs`

**Files:** Create `mira-hub/src/lib/knowledge-graph/inference.ts`; test `__tests__/inference.test.ts`

Pure function: given equipment `{ id, manufacturer, model }[]`, group by normalized `(manufacturer.trim().toLowerCase(), model.trim().toLowerCase())`, skip groups where manufacturer or model is empty/null, and for each group of size ≥2 emit all unordered pairs `{ sourceId, targetId, key }` with `sourceId < targetId` (stable, dedup-friendly). Confidence is assigned by the caller, not here.

- [ ] **Step 1: Write failing tests** — cases: two units same mfr+model → 1 pair; three identical → 3 pairs (all unordered, source<target); different model → 0 pairs; null/empty manufacturer or model → skipped; case/whitespace-insensitive grouping.
- [ ] **Step 2: Run → fail** (`npm test -- inference`).
- [ ] **Step 3: Implement** `inferSameModelPairs(equipment: SameModelInput[]): InferredPair[]`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(kg): inferSameModelPairs pure inference + tests"`

---

### Task 3: Pure inference — `inferCoFailedPairs`

**Files:** Extend `inference.ts` + `__tests__/inference.test.ts`

Pure function: given work-order events `{ equipmentId, at: number /*epoch sec*/ }[]` and `windowSec`, find pairs of **distinct** equipment whose events fall within `windowSec` of each other; emit unordered deduped pairs `{ sourceId, targetId, count }` where `count` = number of co-occurrence windows (evidence strength). Same equipment id → never paired with itself.

- [ ] **Step 1: Write failing tests** — two equipment within window → 1 pair count 1; outside window → 0; same equipment twice → 0; three equipment in one window → 3 pairs; repeated co-occurrences increment `count`; pair order normalized (source<target).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `inferCoFailedPairs(events: CoFailEvent[], windowSec: number): CoFailedPair[]`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(kg): inferCoFailedPairs pure inference + tests"`

---

### Task 4: Proposal writer + inference worker

**Files:** Create `mira-hub/src/lib/knowledge-graph/proposals-writer.ts`; `mira-hub/scripts/kg-infer-proposals.ts`

`upsertInferredProposal(client, tenantId, p)` — given `{ sourceEntityId, sourceEntityType, targetEntityId, targetEntityType, relationshipType, confidence, reasoning, evidence: {evidenceType, sourceDescription, excerpt, confidenceContribution}[] }`: **idempotency first** — skip if a `kg_relationships` edge OR a non-rejected `relationship_proposals` row already exists for the same (tenant, source, target, type); else INSERT the proposal (`status='proposed'`, `created_by='rule'`, `risk_level='low'`, `requires_human_review=true`) then its evidence rows. Mirror the `withKgContext` + parameterized-query style of `cmms-sync.ts`.

Worker `scripts/kg-infer-proposals.ts` (run: `npx tsx scripts/kg-infer-proposals.ts --tenant-id <uuid>`, mirroring `kg-cmms-sync.ts`): for the tenant — (a) query equipment entities (`id, properties->>'manufacturer', properties->>'model_number'`), run `inferSameModelPairs`, write `SAME_MODEL_AS` proposals (confidence 0.6, evidence_type `'manifest'`, reasoning "Identical manufacturer+model: <mfr> <model>"); (b) query work-order events joined to their equipment kg_entities UUID (via `has_work_order` edges or `work_orders.equipment_id`→`kg_entities` of type equipment), run `inferCoFailedPairs` (window 3600s), write `CO_FAILED_WITH` proposals (confidence `min(0.3 + 0.1*count, 0.8)`, evidence_type `'work_order'`, reasoning "Co-occurred in N work-order window(s)"). Log counts.

- [ ] **Step 1: Write `proposals-writer.ts`** with the idempotency guards (SELECT-before-INSERT).
- [ ] **Step 2: Write the worker** wiring DB queries → pure inference → writer. Map equipment_id→kg_entities.id correctly (equipment entity `entity_id` = CMMS equipment id; resolve via a lookup query).
- [ ] **Step 3: `npx tsc --noEmit`** (zero new errors) + `npx eslint` clean on both files. (No live run here — needs Neon; document the run command.)
- [ ] **Step 4: Commit** — `git commit -m "feat(kg): inferred-proposal writer + kg-infer-proposals worker"`

Acceptance: code compiles; idempotency logic visible; worker callable with `--tenant-id`. Live run is a deploy step.

---

### Task 5: Graph endpoint — include proposal edges

**Files:** Modify `mira-hub/src/lib/knowledge-graph/graph-view.ts`, `mira-hub/src/app/api/kg/graph/route.ts`

Add optional `proposalId?: string` to `GraphLink` and a `RelRow.proposal_id?: string | null` field; `buildGraphPayload` carries `proposalId` through when present. In the route, when `?includeProposals=true`, UNION proposal rows:
```sql
SELECT source_id, target_id, relationship_type, confidence, approval_state, NULL::uuid AS proposal_id
  FROM kg_relationships WHERE tenant_id = $1::uuid
UNION ALL
SELECT source_entity_id, target_entity_id, relationship_type, confidence, 'proposed', id AS proposal_id
  FROM relationship_proposals WHERE tenant_id = $1::uuid AND status = 'proposed'
LIMIT $2
```
Without the param, behavior is unchanged (verified edges only).

- [ ] **Step 1:** Extend `graph-view.ts` types + transform; update `__tests__/graph-view.test.ts` to assert `proposalId` passes through (and is absent on verified links).
- [ ] **Step 2:** Run graph-view tests → pass.
- [ ] **Step 3:** Modify the route (param-gated UNION). `npx tsc --noEmit` + `npx eslint` clean.
- [ ] **Step 4: Commit** — `git commit -m "feat(kg): /api/kg/graph optional proposal edges (?includeProposals)"`

---

### Task 6: UI — suggestions toggle + click-to-promote

**Files:** Modify `mira-hub/src/components/kg/GraphCanvas.tsx`, `mira-hub/src/app/(hub)/graph/page.tsx`

GraphCanvas: add optional `onLinkClick?: (link: GraphLink) => void`; pass to ForceGraph2D `onLinkClick`; render proposed links dashed (`linkLineDash={(l)=> l.state==='proposed' ? [4,3] : undefined}` if supported by the lib version, else keep the existing thinner/greyer styling). Page: add a "Show suggestions" checkbox → refetches `/api/kg/graph?includeProposals=true` (vs the plain URL); when a proposed link (has `proposalId`) is clicked, show a small confirm ("Promote <type> suggestion?") → `POST /api/proposals/${proposalId}/decide` body `{decision:"verify"}` → on ok, refetch so the edge becomes solid.

- [ ] **Step 1:** Extend GraphCanvas (`onLinkClick`, dashed proposed). `npx tsc --noEmit` clean.
- [ ] **Step 2:** Add the toggle + promote flow to the page. Filter logic must keep proposed links through the `endId` normalizer already present.
- [ ] **Step 3:** `npx tsc --noEmit` + `npx eslint` clean on both files.
- [ ] **Step 4: Commit** — `git commit -m "feat(kg): graph suggestions toggle + one-click promote proposed edges"`

- [ ] **Step 5: Final review** — superpowers:requesting-code-review over `feat/kg-relationship-graph..HEAD`. Confirm: tenant isolation on the new UNION + promote path; idempotency in the writer; proposals never auto-verify (always human click); migration safe (recreates full CHECK list).

---

## Self-review notes

- **Spec coverage:** infer `same_model_as` + `co_failed_with` as proposals (Tasks 2–4 ✓), through existing approval machinery (writer → existing decide endpoint ✓), dashed suggestions in UI promotable one-click (Tasks 5–6 ✓), migration for the new types (Task 1 ✓). Promotion reuses the existing `/api/proposals/[id]/decide` — no new trust path.
- **Placeholder scan:** none — each task has concrete files, SQL, signatures, acceptance, and a commit. Pure logic is TDD'd; IO (worker/migration) is compile+lint-verified with the live run documented as a deploy step (Neon creds not available in-session), mirroring Phase 1.
- **Type consistency:** `proposalId` (camel) on `GraphLink`, `proposal_id` (snake) on `RelRow` and SQL — transform maps one to the other, asserted in Task 5 tests. `SAME_MODEL_AS`/`CO_FAILED_WITH` spelled identically in migration, worker, and reasoning strings.
- **No silent caps:** the UNION respects `EDGE_CAP`; if proposals push past it, the existing `capped` flag already surfaces truncation.

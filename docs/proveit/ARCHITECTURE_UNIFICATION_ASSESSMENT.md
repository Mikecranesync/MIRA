# FactoryLM Architecture Unification Assessment

**Date:** 2026-06-24 · **Branch:** `docs/proof-packets` · **Commit:** `2556888e` · **PR:** [#2287](https://github.com/Mikecranesync/MIRA/pull/2287)
**Method:** repo search first (two read-only investigation agents, file:line evidence) — **no code written.**
**Bottom line:** The pipeline *Factory Evidence → Proposed Structure → Human Approval → Approved Namespace → Approved Knowledge Graph → Retrieval → MIRA Diagnosis* **already exists at ~75%**. The namespace and the knowledge graph are **one store, not two**. The single broken link is that **retrieval ignores the approval state that already exists** — fixing that one wire converts the entire (already-built) approval stack from cosmetic to authoritative.

---

## Phase 0 — Work protected (evidence)
- **Branch:** `docs/proof-packets` (clean tree; only untracked item is foreign WIP `mira-plc-parser/evals/`, not mine).
- **Latest commit:** `2556888e` — pushed (0 ahead / 0 behind `origin`).
- **PR:** **#2287** → https://github.com/Mikecranesync/MIRA/pull/2287 (proof packets + hardening + gap report).
- All prior work (4 proof PDFs, harness, integrity tests, `NEXT_STEPS_AND_BLIND_SPOTS.md`) is committed, pushed, and now in a PR. Recoverable.

---

## Phase 1 — Capability inventory (does it already exist? evidence)

Legend: ✅ real · 🟡 partial · ❌ missing.

### A. AI-proposed factory structure — ✅ REAL
| Capability | State | Evidence |
|---|---|---|
| propose assets | ✅ | `mira-contextualizer/` (regex+table mining → `extractions`), `mira-crawler/ingest/kg_writer.py` → `kg_entities` (`approval_state='proposed'`), `ai_suggestions` type `kg_entity` (mig 027) |
| propose relationships | ✅ | `mira-crawler/ingest/proposal_writer.py` → `relationship_proposals` + `relationship_evidence` (mig 018), `ai_suggestions` type `kg_edge` |
| propose namespace nodes | ✅ | `kg_entities.uns_path` (ltree, mig 010); `ai_suggestions` type `namespace_move` |
| propose document associations | ✅ | `HAS_DOCUMENT` edges; `namespace_direct_uploads` + `hub_uploads` |
| propose tag associations | ✅ | `ai_suggestions` type `tag_mapping` → `tag_entities`; `mira-plc-parser/` extracts tags |

### B. Approval workflow — ✅ REAL
| Capability | State | Evidence |
|---|---|---|
| approve / reject assets | ✅ | `/knowledge/suggestions` (was `/proposals`) → `/api/proposals/[id]/decide` → `kg_entities.approval_state`. The **only** proposed→verified path. |
| approve / reject documents | 🟡 | governed via `kg_edge`/suggestion path, not a dedicated "document approve" affordance |
| approve / reject mappings | ✅ | `tag_mapping` + `kg_edge` suggestions → same decide route |
| risk + evidence shown | ✅ | suggestions UI renders `risk_level` (safety_critical/high/medium/low) + `evidenceCount` (`suggestions/page.tsx`) |

### C. Knowledge graph — ✅ REAL (incl. visualization)
| Capability | State | Evidence |
|---|---|---|
| store relationships | ✅ | `kg_relationships` (mig 001) |
| store confidence | ✅ | `kg_relationships.confidence`; shown on edge panel (`map/page.tsx:444`) |
| store evidence | ✅ | `relationship_evidence` (mig 018) + `evidence_summary` (mig 029) |
| store approval state | ✅ | `kg_relationships.approval_state` + `kg_entities.approval_state` (mig 029) |
| **visualize relationships** | ✅ | `/knowledge/map` (was `/graph`), `react-force-graph-2d` (`GraphCanvas.tsx`), **solid=verified / dashed=proposed**, confidence + evidence on panels |

### D. Namespace tree — ✅ hierarchy, 🟡 approval surfacing
| Capability | State | Evidence |
|---|---|---|
| represent hierarchy | ✅ | `/namespace` → `/api/namespace/tree`, ltree `uns_path`, ancestors synthesized |
| represent assets | ✅ | `entity_type` ∈ site/plant/area/line/asset/component/document/system |
| represent documents | ✅ | `namespace_direct_uploads` + `hub_uploads` joined into the tree |
| represent tags | 🟡 | tags counted via proposals, **not rendered as tag nodes** |
| represent approval state | 🟡 | shows `proposalsPending`/`proposalsVerified` **counts**, but **NOT** entity-level `approval_state` (the `NamespaceNode` type omits it) |

### E. Retrieval governance — ❌ THE GAP
| Capability | State | Evidence |
|---|---|---|
| see approval state | ❌ | `recall_knowledge` selects no approval column |
| **filter by approval state** | ❌ | **all 5 streams gated by `tenant_id` only** — `neon_recall.py:329/387/432/534/774-790`. Zero approval filter. |
| filter by confidence | 🟡 | vector stream only (`MIN_SIMILARITY=0.70`, `neon_recall.py:99/801`); BM25/ILIKE/fault unfiltered |
| filter by evidence count | ❌ | no `evidence_count` column anywhere |

### F. Diagnosis governance — 🟡 signals only
| Capability | State | Evidence |
|---|---|---|
| consume **approved** context | 🟡 | **signals only**: `ctx_enrichment.fetch_ctx_approved_signals` (`kg_entities WHERE approval_state='verified' AND entity_type='signal'`) → prompt block (`engine.py:3552/3588`, flag `_CTX_SIGNALS_ENABLED`) |
| consume **unapproved** context | ✅ (unfortunately) | all `knowledge_entries` chunks, regardless of approval |
| **distinguish** the two | ❌ | for documents/manuals/fault codes, the engine cannot tell approved from unapproved |

---

## Phase 2 — Gap analysis (exists / partial / missing / duplicate / consolidation)

| Subsystem | Verdict | Duplicate? | Recommended consolidation |
|---|---|---|---|
| Proposed structure (contextualizer, plc-parser, ingest) | **Already exists** | No | Keep. Ensure every proposer writes through `ai_suggestions`/`relationship_proposals` (mostly true). |
| Approval workflow (suggestions UI + decide route) | **Already exists** | No | Keep. One decide route is the single write path — good. |
| Knowledge graph (storage + viz) | **Already exists** | No | Keep `/knowledge/map`. |
| **Namespace tree vs Knowledge graph** | **Already unified** | **No (one store!)** | **Both are projections of `kg_entities`+`kg_relationships`.** `namespace_builder` (mig 021) added **no** entity/relationship tables — only `namespace_versions`/`wizard_progress`/`health_scores`. **Do NOT build a second graph or namespace store.** The only divergence is *rendering*: the tree hides entity `approval_state`; the map shows edge `approval_state`. Consolidation = make the tree surface the same approval state the map already does. |
| Approval state storage | **Already exists** | Slight | `kg_entities.approval_state` + the **unused** `knowledge_entries.verified BOOLEAN` (mig 001). Two governance columns, one consumed, one ignored. Consolidate by **choosing one gate column and wiring it end-to-end.** |
| **Retrieval governance** | **Missing** | No | Add the approval filter (see Phase 4 #1). This is the whole ballgame. |
| Diagnosis governance | **Partial** (signals) | No | Extend the signals-only approval awareness to documents via the retrieval gate. |
| Embedder/reranker health | **Partial** | No | Proof packets now report it; add a health gate (low effort). |
| Observability (Langfuse) | **Exists, degraded here** | No | Deployed Py3.12 path emits; PR #2245 moves to langfuse v4 — align telemetry to it. |

**The unification headline:** there is **no duplicate graph/namespace** to merge — that fear is unfounded. The real fragmentation is **vertical**: approval state is *stored* (KG), *shown* (map), and *decided* (decide route), but **not enforced where it matters (retrieval)**. The product is one coherent store with a severed last mile.

---

## Phase 3 — Thesis validation (with evidence)

> "FactoryLM ingests messy factory evidence and proposes a factory architecture. Human approvals transform proposed knowledge into approved knowledge. MIRA diagnoses only from approved factory context."

| Clause | Verdict | Evidence |
|---|---|---|
| "ingests messy evidence and **proposes** a factory architecture" | **PROVEN** | contextualizer + plc-parser + ingest → `ai_suggestions`/`relationship_proposals`/`kg_entities(proposed)` |
| "**human approvals transform** proposed → approved knowledge" | **PARTIALLY PROVEN** | the decide route flips `approval_state` to `verified` and the KG map reflects it — **but that transformation does not change what MIRA can cite** (retrieval is ungated), so "approved knowledge" has no teeth downstream |
| "MIRA diagnoses **only from approved** context" | **NOT PROVEN (false today)** | `recall_knowledge` cites every chunk regardless of approval; only signals are gated. **This is the claim that breaks.** |

**So 1 of 3 clauses is true, 1 is half-true, 1 is false — and the same single fix (approval-gated retrieval) flips the half-true and false clauses to true.**

---

## Phase 4 — Highest-leverage changes (ranked)

Scoring: **D**=demo value, **P**=product value, **E**=engineering effort (lower=cheaper). ★ = small change, large narrative unlock.

| # | Change | D | P | E | Notes |
|---|---|---|---|---|---|
| **1 ★** | **Approval-gated retrieval** — gate `recall_knowledge` on approval (behind a flag) | **High** | **High** | **Med** | The keystone. Converts the *entire* existing approval stack (UI + KG + decide route) from cosmetic to authoritative. Requires a backfill so the OEM/seeded corpus stays visible (it defaults un-verified). |
| **2 ★** | **Backfill + wire the approve action to set the gate** — mark existing corpus `verified`, and make `/api/proposals/[id]/decide` (or the upload/approve path) set `knowledge_entries.verified`/`approval_state` | Med | High | Med | Prerequisite + the other half of #1. Without this, gating breaks all retrieval. |
| **3 ★** | **Surface entity `approval_state` in the namespace tree** — add the field the `kg_entities` row already has to `NamespaceNode` + render proposed/verified | Med | Med | **Low** | Pure projection fix; the data is already there. Makes the tree governance-honest like the map. |
| **4** | **One end-to-end discovery→approve→diagnose proof packet** — upload a manual → contextualizer proposes → Hub approve → that approval makes it citable → MIRA cites it | **High** | High | Med | Proves the full thesis once. Depends on #1–#2. |
| **5 ★** | **"Answered from N approved sources" in the diagnosis/proof packet** — show governance in the answer | High | Med | **Low** | Cheap credibility; reads the gate decision from #1. |
| **6** | **Close the rubric gap to 3/3** (capper root-cause phrase; casepacker asset tokenization; citation section-vs-filename) | Med | Med | Med | Honesty: today 1/3 real scenarios pass the strict rubric. |
| **7** | **`live_signal_cache → engine` read path** (via `/api/mira/ask`) instead of direct `live_tags` injection | High | High | Med | Makes "attach live data" literal, not staged. |
| **8** | **Confidence/evidence threshold on non-vector streams** | Low | Med | Med | Retrieval quality at scale; pairs with embedder restoration. |
| **9** | **Embedder + reranker health gate** (proof already reports `bm25-only`) | Med | Med | Low | Stop silent degradation; alert when vectors are down. |
| **10** | **Langfuse v4 alignment** (telemetry uses v2 `.trace()`; PR #2245 bumps to v4) | Low | Med | Med | Restores real traces on the deployed path. |

**Where approval state already exists but is ignored:** `kg_entities.approval_state` (consumed only for signals), `kg_relationships.approval_state` (shown on the map, not used in retrieval), and `knowledge_entries.verified` (exists since mig 001, **never queried**). Three governance signals already in the schema; retrieval consults none of them.

**Where namespace and graph describe the same info differently:** they don't *store* it differently — both read `kg_entities`/`kg_relationships`. They only *render* approval differently (tree hides it, map shows it). Item #3 closes that.

**Where retrieval bypasses governance:** `neon_recall.recall_knowledge` — all five streams (`neon_recall.py:329/387/432/534/774-790`).

---

## Recommendation — should approval-gated retrieval be the next implementation task?

**YES — it is unambiguously the next task, and it is the highest-leverage change available.**

Reasoning, grounded in the evidence:
1. **Everything else in the thesis is already built.** Proposers, the approval UI, the decide route, the KG, the KG visualization, the namespace tree, and the `approval_state` columns are all REAL. The only severed wire is retrieval.
2. **It is the literal difference between "cosmetic" and "authoritative."** Today a user can approve/reject in the Hub and it changes the graph picture but **not what MIRA cites**. Gating retrieval on approval is what makes the approval workflow *mean something*. That single change flips Phase-3 clauses 2 and 3 from half-true/false to true.
3. **It is a small, contained change** — add an approval predicate to one function's five streams, behind a flag — **but it has one mandatory prerequisite**: a backfill/default so the shared OEM corpus and already-seeded docs remain visible (the gate column defaults to un-verified, so naive gating returns zero chunks and breaks all retrieval — the agent confirmed this risk). So the task is really a 4-part wire-up, not a 1-liner:
   - (a) **Choose the gate column** — reuse the existing `knowledge_entries.verified BOOLEAN`, or add `approval_state` mirroring `kg_entities`. (Lean: reuse `verified` to avoid a new column; revisit if richer states are needed.)
   - (b) **Backfill** existing OEM/seeded corpus to `verified=true` (so nothing disappears).
   - (c) **Wire the approve action** (decide route / upload path) to set the gate on per-tenant docs.
   - (d) **Gate retrieval** behind `MIRA_ENFORCE_APPROVED_RETRIEVAL` (default off → on after backfill), with a test that an **unapproved** chunk is NOT cited and an **approved** one IS.
4. **Do NOT** build a new graph, a new namespace system, or a second approval system — they exist and are unified. This is wiring, not architecture.

**One honest caveat:** this is a governance/correctness change with real blast radius (it touches the live retrieval path). It must go dev → staging → prod behind the flag, with the backfill proven on staging first (per `docs/environments.md`). The proof harness (`tools/proof/`) is the ready-made staging verification: re-run it with the flag on and confirm the approved SimLab corpus still answers.

---

## Final output (summary)
- **Branch:** `docs/proof-packets`
- **Commit SHA:** `2556888e`
- **PR:** #2287 — https://github.com/Mikecranesync/MIRA/pull/2287
- **Architecture assessment:** ~75% of the ProveIt pipeline exists; namespace+KG are one unified store; the broken link is ungated retrieval.
- **Existing capabilities:** propose (A ✅), approve (B ✅), KG + viz (C ✅), namespace tree (D ✅/🟡), approval columns (✅, partly unused).
- **Gaps:** retrieval approval filter (❌), entity approval_state in tree (🟡), document-level approve affordance (🟡), confidence/evidence gating (🟡/❌), 3/3 rubric, live-cache read path.
- **Unification plan:** keep the single `kg_entities`/`kg_relationships` store; surface its approval state in the tree (#3); **enforce it in retrieval (#1–#2)**; show it in the answer (#5). No new systems.
- **Top 10 tasks:** see Phase 4.
- **Recommendation:** **approval-gated retrieval is the next task** — the keystone wire-up (with backfill) that makes the existing approval stack authoritative.

## Cross-references
- `docs/proveit/NEXT_STEPS_AND_BLIND_SPOTS.md` — the companion blind-spots report
- `mira-bots/shared/neon_recall.py` (the ungated retrieval), `ctx_enrichment.py` (the one approval-aware path)
- `mira-hub/src/app/api/{namespace/tree,kg/graph,proposals/[id]/decide}/route.ts` — the unified projections + the verify path
- migrations: `kg`/`001_knowledge_graph`, `010_kg_uns_path`, `018_relationship_proposals`, `021_namespace_builder`, `027_ai_suggestions`, `029_kg_approval_state`; `docs/migrations/001_knowledge_entries.sql` (the unused `verified` column)

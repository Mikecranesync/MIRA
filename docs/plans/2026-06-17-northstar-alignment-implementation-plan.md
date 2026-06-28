# FactoryLM + MIRA Northstar Alignment — Implementation Plan

> **For agentic workers:** REQUIRED execution model — each phase is a self-contained PR. Use `superpowers:subagent-driven-development` (fresh subagent per task + two-stage review) to implement a phase, after generating the phase's detailed task plan with the `Plan` agent + `superpowers:writing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking. Isolate each phase in its own worktree via `superpowers:using-git-worktrees`.

**Goal:** Bring the MIRA monorepo into alignment with the corrected Northstar — *FactoryLM is the self-serve maintenance **context platform**; MIRA is the **Maintenance Intelligence Resource Agent** that uses FactoryLM's approved context* — by closing the gaps the audit found, one shippable PR at a time.

**Source of truth:** `docs/product/factorylm-maintenance-context-platform-and-mira-agent-prd.md` (the PRD + repo audit). This plan operationalizes that PRD's §16 Roadmap and §20 Next PRs.

**Architecture:** Each phase produces working, testable software on its own and maps to (a) a primary **sub-agent**, (b) the **repo skills** that gate or guide it, and (c) explicit verification/evidence. Cross-cutting guardrail skills run on *every* phase. Phases are ordered by the PRD's "fix immediately" priority, then dependency order.

**Tech stack:** Next.js/TypeScript (`mira-hub`), Python 3.12 + ruff + httpx (`mira-bots`, `mira-pipeline`, `mira-crawler`, `mira-core`), NeonDB (UNS ltree + RLS), Ignition WebDev/Perspective (Jython 2.7 + CPython 3.12 dual), Doppler secrets, GitHub Actions CI (Version Bump + staging gate + smoke).

---

## How to use this plan

1. **Pick the lowest-numbered unstarted phase** (respect the dependency graph in §Sequencing).
2. **Create an isolated worktree** off fresh `main` (`superpowers:using-git-worktrees`).
3. **Run CodeGraph preflight** for the phase's modules: `tools/codegraph-preflight.sh "<phase task>"`. If STALE/BROKEN, `sync`/`index --force` first (`.claude/rules/codegraph-usage.md`).
4. **Generate the phase's detailed bite-sized plan** with the `Plan` agent (`superpowers:writing-plans`) — Phases 1 & 2 already have full task breakdowns below; Phases 3–10 carry a brief that the Plan agent expands at kickoff.
5. **Implement with `superpowers:subagent-driven-development`** (fresh subagent per task, TDD, frequent commits).
6. **Run the phase's verification gate**, capture evidence.
7. **Ship via `ship-pr`** (branch fresh off main, run affected tests, distinguish pre-existing failures, open PR with evidence body, poll CI to green). Hand off to `ship` for merge→deploy→verify when applicable.

### Sub-agent roster (from this repo)
| Agent | Use for |
|---|---|
| `Explore` | Read-only fan-out discovery before a phase |
| `Plan` | Expand a phase brief into a bite-sized TDD plan |
| `feature-dev:code-architect` | Design the change against existing patterns |
| `feature-dev:code-explorer` | Trace an existing flow end-to-end |
| `feature-dev:code-reviewer` / `superpowers:code-reviewer` | Pre-merge review |
| `maintenance-diagnostician` | Debug MIRA pipeline (engine/RAG/FSM/guardrails) regressions |
| `code-simplifier` | Post-implementation cleanup (quality only) |

### Cross-cutting guardrail skills (apply to EVERY phase)
- `mira-architecture-guardian` + `mira-platform` — every change is checked against doctrine, environment boundaries, provider cascade, and the FactoryLM-platform / MIRA-agent split.
- `mira-saas-scope-guard` — classify each phase Core / Adjacent / Defer; reject scope creep.
- `mira-industrial-safety` — any output that could touch energized equipment / LOTO / write paths triggers STOP+escalate review.
- `mira-run-hallucination-audit` — run after any `engine.py`/bot/gate edit.
- Screenshot Rule (`docs/promo-screenshots/`, desktop 1440×900 + mobile 412×915) for any visible `mira-hub`/`mira-web` UI change.
- Environment doctrine (`docs/environments.md`): engine/RAG/FSM/classifier + migration changes pass the staging gate before merge; no prod psql, no direct VPS compose, no feature-branch traffic to `@FactoryLM_Diagnose`.

---

## Phase map (at a glance)

| # | Phase | Primary agent | Key skills | Surface | PRD ref | Status |
|---|---|---|---|---|---|---|
| 0 | Land PRD + this plan | (this session) | `mira-platform` | docs | §20.1 | ✅ done (#2078) |
| 1 | Fence the Perspective write surface | `feature-dev:code-architect` | `mira-industrial-safety`, `ignition-webdev`, `mira-saas-scope-guard` | Ignition | §20.2 / §18 RISK | ✅ done (#2079) |
| 2 | "Why MIRA Thinks This" panel | `feature-dev:code-architect` | `slack-technician-ux-writer`, `bot-grounding-tests` | MIRA + Hub | §20.3 / §11 | ✅ done (#2081) |
| 3 | Close upload→retrieval gap (beta gate green) | `maintenance-diagnostician` | `manual-ingestion-extractor`, `knowledge-ingest`, `mira-test-bot-grounding` | FactoryLM+MIRA | §20.4 | ✅ done (#1592/#1863/#1911/#2077/#2100 — gate green pre-plan) |
| 4 | Asset-agent deploy gate resolver | `feature-dev:code-architect` | `uns-location-gate-designer`, `mira-uns-architecture` | MIRA | §20.6 | ⬜ next |
| 5 | Actionable readiness checklist (L0–L6) | `feature-dev:code-architect` | `mira-platform`, `component-profile-builder` | FactoryLM | §20.5 | ⬜ |
| 6 | ContextPackage compiler | `feature-dev:code-architect` | `managing-the-knowledge-graph`, `mira-uns-architecture` | FactoryLM | §20.7 | ⬜ (needs 5 + 8) |
| 7 | Source-authority ranking | `maintenance-diagnostician` | `bot-grounding-tests`, `knowledge-graph-proposer` | FactoryLM | §20.8 | ⬜ (needs 3) |
| 8 | Parser→Hub tag-import CSV wizard | `feature-dev:code-architect` | `plc-tag-mapper`, `ignition-webdev` | FactoryLM | §20.9 | ✅ done (#2084/#2145/#2147) |
| 9 | Work-order history mining | `maintenance-diagnostician` | `work-order-history-miner` | FactoryLM | §16 P6 | ⬜ (needs 6) |
| 10 | Consolidate TechnicianFeedback | `feature-dev:code-architect` | `managing-the-knowledge-graph` (+ `mira-hub-migrations` rule) | both | §20.10 | ⬜ (needs 2 ✅) |

---

## Sequencing & dependencies

```
Phase 0 ✅ (done)
   │
   ├─ Phase 1 ✅ (#2079 — safety/anti-goal)
   ├─ Phase 2 ✅ (#2081 — data already persisted)
   ├─ Phase 3 ✅ (beta gate green pre-plan — #1592/#1863/#2077)
   │
Phase 3 ✅ ──► Phase 7 (authority ranking needs the retrieval path working — now unblocked)
Phase 4  ⬜ NEXT (independent of 1–3; needs asset_agent_status which exists)
Phase 5  ⬜ (independent; reads health_scores)
Phase 8 ✅ (#2084/#2145/#2147 — parser exists)
Phase 6 ──► consumes outputs of 5 (maturity) and 8 ✅ (mappings); start after 5
Phase 6 ──► Phase 9 (historical reasoning sits on the context package)
Phase 2 ✅ + Phase 10 (feedback store) compose: do 10 after 2 so the panel writes somewhere
```

**Parallelizable now (no shared files):** Phases 1, 2, 3, 4, 5, 8 can each run in their own worktree concurrently. Use `superpowers:dispatching-parallel-agents` to fan out the *design+exploration* step of several phases at once; serialize the *merge* step through `ship-pr` to avoid main churn. **Engine-touching phases (2, 3, 4, 7) serialize at the staging gate.**

---

## Chunk 1: Immediate phases (full task breakdowns)

### Phase 0 — Land the PRD + this plan  ✅ (this session)

**Files:**
- Create: `docs/product/factorylm-maintenance-context-platform-and-mira-agent-prd.md` (done)
- Create: `docs/plans/2026-06-17-northstar-alignment-implementation-plan.md` (this file)

- [x] PRD authored from 6-agent repo audit with path-anchored evidence.
- [x] This implementation plan authored.
- [ ] **Open as a docs PR** via `ship-pr` (branch `docs/northstar-alignment-prd` off fresh main; docs-only ⇒ no VERSION bump required by the Version Bump Check). Cross-link from `docs/THEORY_OF_OPERATIONS.md` and `CLAUDE.md` North Star pointer.
- [ ] **Commit:** `docs(product): FactoryLM context-platform + MIRA agent PRD + alignment plan`

**Exit criteria:** PRD + plan merged to `main`; both linked from doctrine.

---

### Phase 1 — Fence the customer-shipped Perspective write surface

> **Why first:** This is the only *active* violation of the read-only anti-goal (PRD §18) — `SpeedControl`/`FaultLog` Perspective views ship `system.tag.writeBlocking()` to the VFD. Safety + scope, smallest blast radius.

**Primary agent:** `feature-dev:code-architect` (design) → `feature-dev:code-reviewer` (review).
**Skills (mandatory):** `mira-industrial-safety` (owns STOP+escalate + write-path doctrine), `ignition-webdev` (config-as-files deploy + allowlist), `mira-saas-scope-guard` (writes are Defer/out-of-scope for customer surfaces).
**Doctrine:** `.claude/rules/fieldbus-readonly.md`, `docs/mira-ignition-secure-architecture.md` §8 anti-patterns #1/#4/#6.

**Files:**
- Modify: `ignition/project/com.inductiveautomation.perspective/views/SpeedControl/resource.json` (remove/relocate `system.tag.writeBlocking` to `VFD_FreqSetpoint_Raw`)
- Modify: `ignition/project/com.inductiveautomation.perspective/views/FaultLog/resource.json` (remove/relocate fault-reset + `VFD_CmdWord` writes)
- Create (if "operator mode" is kept): a **separate bench-only project tree** under `plc/ignition-project/testing/` with a BENCH-ONLY banner, OR a feature-flagged + two-step-approved control surface (per secure-arch §4.2)
- Create: `.github/` CI guard — a read-only audit step that greps shipped Ignition views for `system.tag.write*` and fails the build
- Modify: `docs/mira-ignition-secure-architecture.md` (record the decision)

- [ ] **Step 1 — Decide intent (human gate).** Use `AskUserQuestion`: is the VFD control surface (a) removed from customer ship, (b) moved to a bench-only project, or (c) kept behind a feature flag + two-step approval? Default recommendation: **(b) bench-only**, consistent with `live_monitor.py` fencing. Do not proceed until answered.
- [ ] **Step 2 — Write the failing guard test.** Add `tests/regime7_ignition/test_no_customer_write_paths.py` that scans the shipped Perspective project dir for `writeBlocking|writeAsync|writeBlockingAsync` and asserts zero matches in customer-shipped views.

```python
# tests/regime7_ignition/test_no_customer_write_paths.py
import pathlib, re
SHIPPED = pathlib.Path("ignition/project/com.inductiveautomation.perspective/views")
WRITE = re.compile(r"system\.tag\.write(Blocking|Async|BlockingAsync)?")
def test_no_write_calls_in_shipped_perspective_views():
    hits = [str(p) for p in SHIPPED.rglob("resource.json")
            if WRITE.search(p.read_text(encoding="utf-8"))]
    assert hits == [], f"customer-shipped views contain write paths: {hits}"
```

- [ ] **Step 3 — Run it; verify it FAILS** (lists SpeedControl/FaultLog). `pytest tests/regime7_ignition/test_no_customer_write_paths.py -v`
- [ ] **Step 4 — Apply the chosen disposition** (remove / relocate / flag) per Step 1.
- [ ] **Step 5 — Run test; verify it PASSES.**
- [ ] **Step 6 — Wire the guard into CI** as a job (mirrors the existing read-only audit pattern). Confirm it fails on a planted write and passes after revert.
- [ ] **Step 7 — `mira-industrial-safety` review pass** + `feature-dev:code-reviewer`.
- [ ] **Step 8 — Commit + ship-pr.** `security(ignition): remove customer-shipped VFD write paths; add read-only CI guard`

**Verification/evidence:** new test red→green; CI guard job green; diff shows no `system.tag.write*` in shipped views.
**Exit criteria:** No write-to-plant path ships in a customer Ignition surface; CI prevents regression.

---

### Phase 2 — "Why MIRA Thinks This" panel

> **Why now:** The decision trace is already persisted (`mira-bots/shared/decision_trace.py` → `decision_traces`, migration 032). The gap is purely *surfacing* it. High trust value, low risk (read-only render).

**Primary agent:** `feature-dev:code-architect` (Hub panel + read API) → `maintenance-diagnostician` (verify trace fields) → `feature-dev:code-reviewer`.
**Skills (mandatory):** `slack-technician-ux-writer` (plain technician language; lead with context→evidence→next-check), `bot-grounding-tests` (don't regress citation/grounding), `mira-uns-architecture` (UNS path display).
**Doctrine:** PRD §11 (exact panel contract), `.claude/CLAUDE.md` § Grounded troubleshooting.

**Files:**
- Create: read API to fetch a turn's trace — `mira-hub/src/app/api/decision-trace/[turnId]/route.ts` (raw-pool read, tenant-scoped; respects `knowledge-entries-tenant-scoping` if it joins KB)
- Create: panel component — `mira-hub/src/components/WhyMiraThinksThis.tsx`
- Modify: `mira-hub/src/components/AssetChat.tsx` (add a "Why MIRA thinks this" expander per answer)
- Modify (engine side, if the trace id isn't returned to the client today): `mira-bots/shared/engine.py` answer envelope to include `decision_trace_id` (guarded — run `codegraph_impact` first)
- Test: `mira-hub/tests/` render test + `tests/` engine envelope test

- [ ] **Step 1 — Explore.** `feature-dev:code-explorer`: trace how `decision_traces` rows are written (`decision_trace.py:write_trace`) and whether a trace id reaches the chat client today. Output the exact column set and the answer-envelope shape.
- [ ] **Step 2 — Failing test (read API).** Assert `GET /api/decision-trace/{id}` returns `{context_used, context_ignored, evidence[], freshness, decision_path, sources[], confidence, missing_context, next_check}` for a seeded row, and 404 cross-tenant.
- [ ] **Step 3 — Run; verify FAIL.**
- [ ] **Step 4 — Implement the read API** (raw owner pool + explicit tenant predicate; never `withTenantContext` if it joins `knowledge_entries`).
- [ ] **Step 5 — Run; verify PASS.**
- [ ] **Step 6 — Failing render test** for `WhyMiraThinksThis.tsx` against the PRD §11 example structure (evidence rows with freshness, decision path, confidence, missing-context, next-check, feedback buttons).
- [ ] **Step 7 — Implement panel + wire into `AssetChat`.** Plain language per `slack-technician-ux-writer`.
- [ ] **Step 8 — Run render test; verify PASS.** Capture desktop+mobile screenshots → `docs/promo-screenshots/`.
- [ ] **Step 9 — If engine envelope changed:** `codegraph_impact` on the changed symbol, run `bot-grounding-tests`, run `mira-run-hallucination-audit`, pass the staging gate.
- [ ] **Step 10 — Reviews:** `maintenance-diagnostician` (trace fidelity) + `feature-dev:code-reviewer`.
- [ ] **Step 11 — Commit + ship-pr.** `feat(mira): surface decision trace as "Why MIRA Thinks This"`

**Verification/evidence:** read-API test + render test green; screenshots in promo folder; grounding suite unchanged; hallucination audit clean.
**Exit criteria:** Every MIRA answer in the Hub can expand into evidence + decision path + confidence + missing-context + next-check + feedback controls, all from real `decision_traces` data.

---

## Chunk 2: Beta-critical & enforcement phases (briefs — expand with Plan agent at kickoff)

### Phase 3 — Close the upload→retrieval gap (turn the beta gate green)  ✅ DONE (gate was green before this plan landed)

> **STATUS (verified 2026-06-21): COMPLETE — no code needed.** The upload→retrieval gap closed the *same day this plan was written* via a parallel effort, so the beta gate has been green since 2026-06-17. Evidence: `tests/beta/beta_ready_upload_retrieval_citation.py` is **un-xfailed and a real assertion** (#2077); `.github/workflows/beta-gate.yml` runs it against a stranger on staging Neon and has been **green on its last several runs** (incl. 2026-06-20); `docs/known-issues.md` § "Beta Gate" = *"PASSING on deploy truth"*; `docs/plans/2026-06-07-path-to-beta.md` = *"the HTTP beta gate RAN GREEN end-to-end. The gate is MET."*
>
> **Note — the brief below is partly superseded.** Citability was achieved through the **Hub NodeChat node-attach door** (#1592 folder=brain; #1863 routes *blind* uploads through a per-tenant Inbox node, closing #1806; #1911 `is_private=true`; #2100 embed-on-write), **not** by extending `/api/uploads/folder` as the brief proposed — that door writes only the Open WebUI KB and "can never cite" (see the gate test header). Treat the brief as historical context; the exit criterion is met.

> **Why (original):** This was the actual beta blocker (PRD §6.5, §20.4). Uploads land in Open WebUI KB; retrieval reads `knowledge_entries`. The two stores weren't bridged for the blind upload doors.

**Primary agent:** `maintenance-diagnostician`. **Skills:** `manual-ingestion-extractor`, `knowledge-ingest`, `mira-test-bot-grounding`, `bot-grounding-tests`.
**Doctrine (critical):** `.claude/rules/knowledge-entries-tenant-scoping.md` — per-tenant uploads write `is_private=true`; hybrid reads use raw pool + `(is_private=false OR tenant_id=$caller)`, never `withTenantContext`.
**Brief / acceptance:** Make a stranger's uploaded manual retrievable + citable on at least one chat surface without manual fixing → `tests/beta/beta_ready_upload_retrieval_citation.py` passes (un-xfail). Reuse the merged PR #1592 node-attach path (`mira-hub/src/lib/node-knowledge-ingest.ts`, `manual-rag.ts`); extend the blind upload doors (`/api/uploads`, `/api/uploads/folder`, #1806) to ingest into `knowledge_entries` with chunk anchors (migration 045) and `is_private=true`. Provision/point at the durable dev/staging endpoint the gate needs.
**Verification:** beta gate green; `mira-test-bot-grounding` shows uploaded-manual citations; tenant-scoping audit (no `knowledge_entries` read without the hybrid filter; no insert without `is_private=true`). Staging gate before merge.
**Exit criteria:** Beta gate is GREEN by behavior, not by xfail.

### Phase 4 — Asset-agent deployment gate resolver (`asset_id → uns_path`)

> **Why:** `ENFORCE_ASSET_AGENT_GATE` logic exists but is non-functional — no resolver maps Ignition `asset_id`/tag paths to stored `equipment_id`/`uns_path`, so it refuses-all if enabled (PRD §6.2, §20.6).

**Primary agent:** `feature-dev:code-architect`. **Skills:** `uns-location-gate-designer`, `mira-uns-architecture`, `plc-tag-mapper` (tag-path→asset).
**Doctrine:** `.claude/rules/direct-connection-uns-certified.md`, `.claude/rules/train-before-deploy.md`, `docs/specs/asset-agent-validation-spec.md`.
**Brief / acceptance:** Implement the resolver in `mira-pipeline/ignition_chat.py` (`_lookup_agent_state`) so an Ignition asset identifier resolves to `asset_agent_status`. Gate behavior: `deployed` → answer; `approved`+enforce → answer; otherwise → `GATE_REFUSAL_MESSAGE`. Direct connection without a resolvable UNS id → reject `uns_required` (do NOT downgrade to chat-gate).
**Verification:** gate-decision unit tests (deployed/approved/draft/missing); `mira-run-hallucination-audit` clean; staging gate. Keep default OFF until proven.
**Exit criteria:** With the flag on, MIRA answers only for approved/deployed assets; unapproved assets get the refusal, unresolvable ids get `uns_required`.

---

## Chunk 3: Platform depth phases (briefs)

### Phase 5 — Actionable readiness checklist (L0–L6)

**Agent:** `feature-dev:code-architect`. **Skills:** `mira-platform`, `component-profile-builder`.
**Brief:** Turn the opaque `nextStep` string (`mira-hub/src/lib/health-score.ts`, `api/readiness`) into a per-asset checklist that names the concrete missing items to climb a level (e.g., "map 2 more required signals", "link 1 manual", "verify live values") with deep links into the mapper/document/CMMS surfaces. **Verification:** level-transition unit tests; screenshots. **Exit:** each asset shows what to do next to raise maturity.

### Phase 6 — ContextPackage compiler

**Agent:** `feature-dev:code-architect`. **Skills:** `managing-the-knowledge-graph`, `mira-uns-architecture`. **Rule:** `mira-hub-migrations` (tenant-id family: equipment=TEXT vs kg/Hub=UUID).
**Brief:** Introduce a first-class **ContextPackage** that compiles, per asset, the approved mappings (`installed_component_instances`), grounded docs (`knowledge_entries` subtree), verified relationships (`kg_relationships`), and maturity (`health_scores`) into one trusted bundle MIRA reads. Depends on Phase 5 (maturity) and benefits from Phase 8 (mappings). **Verification:** compile+read-back for the conveyor/GS10 asset; migration dry-run dev→staging; correct tenant-id family. **Exit:** one queryable approved-context bundle per asset.

### Phase 7 — Source-authority ranking

**Agent:** `maintenance-diagnostician`. **Skills:** `bot-grounding-tests`, `knowledge-graph-proposer`. **Depends on:** Phase 3.
**Brief:** Add authority weighting at retrieval (`mira-bots/shared/neon_recall.py`) so OEM manual > approved tech note > forum, combined with existing confidence. Document the bands (extend `docs/specs/uns-message-resolver-spec.md §2.4` confidence-band convention; don't invent a parallel scheme). **Verification:** ordering unit tests; grounding suite unchanged; staging gate. **Exit:** retrieval prefers higher-authority evidence when multiple sources match.

### Phase 8 — Parser → Hub tag-import CSV wizard

**Agent:** `feature-dev:code-architect`. **Skills:** `plc-tag-mapper`, `ignition-webdev`.
**Brief:** Wire `mira-plc-parser` output (tag dict + VFD signal candidates + roles, with `source`/`confidence`) into a Hub importer that creates `tag_mapping` proposals in the existing queue (`knowledge/suggestions`). No auto-verify — everything lands as a proposal a human approves. **Verification:** importer unit tests (CSV + L5X → proposals); screenshot. **Exit:** uploading a PLC export produces reviewable tag proposals.

### Phase 9 — Work-order history mining

**Agent:** `maintenance-diagnostician`. **Skills:** `work-order-history-miner`. **Depends on:** Phase 6.
**Brief:** Add an extractor over WO history (Atlas / MaintainX models already present) for fault frequency, resolution patterns, MTTR, and technician notes, surfaced as grounded evidence in `neon_recall` WO path (currently effectively a no-op). **Verification:** golden cases over WO history; grounding suite. **Exit:** MIRA can cite prior failures/resolutions for an asset.

### Phase 10 — Consolidate TechnicianFeedback

**Agent:** `feature-dev:code-architect`. **Skills:** `managing-the-knowledge-graph`. **Rule:** `mira-hub-migrations`. **Depends on:** Phase 2.
**Brief:** Unify scattered feedback (`feedback_log`, `decision_traces.technician_confirmed`, `asset_validation_qa.reviewer_verdict`) into one feedback store + a "missing context" verb wired to the Phase 2 panel buttons. **Verification:** write-path round-trip with a real slug tenant (`'mike'`) and a uuid tenant; migration dry-run dev→staging. **Exit:** correct/wrong/missing-context captured uniformly and feed `few_shot_trainer`.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Engine/RAG edits regress grounding | `bot-grounding-tests` + `mira-run-hallucination-audit` + staging gate are mandatory gates on Phases 2, 3, 4, 7. |
| Tenant-scoping leak/disappearance on `knowledge_entries` | Follow `knowledge-entries-tenant-scoping` exactly (Phases 3, 6). Audit every read/write in review. |
| Migration tenant-id type mismatch | `mira-hub-migrations` rule (TEXT vs UUID family); dry-run dev→staging; verify with real `'mike'` slug (Phases 6, 10). |
| Re-introducing a write-to-plant path | Phase 1 CI guard greps shipped views; `mira-industrial-safety` reviews any Ignition/PLC phase. |
| Scope creep (generic chatbot / dashboard / canvas) | `mira-saas-scope-guard` classifies every phase; reject Adjacent/Defer work into follow-ups. |
| Stale CodeGraph call edges | `tools/codegraph-preflight.sh` before each code phase; trust call-graph only after freshness passes. |
| Parallel worktrees churning main | Serialize the merge step through `ship-pr`; only fan out design/exploration in parallel. |

## Definition of done (program level)
- All 10 phases merged to `main`; each shipped via `ship-pr` with an evidence body.
- Beta gate (`tests/beta/beta_ready_upload_retrieval_citation.py`) GREEN (Phase 3).
- No customer-shipped write-to-plant path (Phase 1 CI guard green).
- A stranger can: create an asset → import + map tags → approve → ask MIRA → open "Why MIRA Thinks This" → mark feedback — end to end, no manual fixing.
- PRD §19 alignment score re-audited and materially improved (target ≥ 8/10 overall).

---

### Execution handoff
Plan saved to `docs/plans/2026-06-17-northstar-alignment-implementation-plan.md`. Phases 1 & 2 are ready to execute as-is via `superpowers:subagent-driven-development`; Phases 3–10 expand into bite-sized plans via the `Plan` agent at kickoff. Recommended start order: **Phase 1 (safety) → Phase 2 (trust) → Phase 3 (beta)**, runnable in parallel worktrees.

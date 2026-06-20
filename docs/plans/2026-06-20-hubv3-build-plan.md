# HubV3 — Token-Efficient Phased Build Plan (subagents + design skills)

**Companion to:** `2026-06-20-hubv3-contextualization-intake-prd.md`
**Purpose:** how to execute the 9 phases cheaply — which subagents do the work, which design skills shape it, what runs in parallel, and how we keep the orchestrator's context small.

---

## Token-efficiency operating rules

1. **Orchestrator never reads code directly.** All code inspection + edits go to subagents; the main thread holds only the PRD, gap reports, and phase verdicts. (Already done: 3 Explore agents produced §4 gap analysis.)
2. **One contract, three consumers.** The Phase-0 intake contract is authored ONCE (TS + Python dataclass + JSON Schema) and imported by Hub, offline, Telegram. No re-derivation per client → no duplicated design tokens.
3. **Worktree isolation for parallel code edits.** Any phase where ≥2 agents touch files run in `isolation: worktree` so they don't collide; auto-cleaned if unchanged.
4. **Pipeline, don't barrier.** Phases that don't share state stream (P5 offline + P6 Telegram can run after P4 in parallel). Only gate where a later phase needs the earlier phase's merged output (P1→P2→P3→P4 are a hard chain).
5. **Each phase gate = a durable commit.** Checkpoint before the next phase so a dropped session resumes from the last green gate, not the start.
6. **Design skills shape, subagents build.** Skills are invoked by the orchestrator (cheap, guidance-only); the heavy file work is the subagent's.
7. **Findings as structured returns, not transcripts.** Subagents return only the gate verdict + changed-file list + test output tail.

---

## Design skills used (and where)

| Skill | Phase | Why |
|---|---|---|
| `analysis-process` | 0 | already producing this PRD/spec set |
| `superpowers:writing-plans` | 0–1 | turn each phase into a step-by-step impl plan before code |
| `grill-with-docs` | 0 | stress-test the contract against MIRA's existing domain model (glossary: `ai_suggestions`, `relationship_proposals`, ADR-0017) before committing schema |
| `to-issues` | 0 | break phases into independently-grabbable tickets (tracer-bullet vertical slices) |
| `mira-architecture-guardian` + `mira-platform` | every gate | alignment review: Hub-as-SoR, no scope creep, provider/UNS/tenancy invariants |
| `mira-uns-architecture` | 1,4,5 | UNS path construction + the proposed→approved gate; ltree storage |
| `managing-the-knowledge-graph` | 1,4 | proposed vs verified status, `kg_entities`/`kg_relationships`, ADR-0017 transitions |
| `superpowers:test-driven-development` | 2–6,8 | write the §6 acceptance tests first, then make them pass |
| `designer` (agent) | 7 | shared label/mental-model UI parity Hub↔offline |
| `superpowers:verification-before-completion` | every gate | evidence-before-assertion; run tests, show output |
| `documentation-process` | 8 | Hub-as-SoR explainer + demo instructions |

**Repo rules that are hard gates (not skills, but enforced every phase):**
`.claude/rules/mira-hub-migrations.md` (P1), `.claude/rules/knowledge-entries-tenant-scoping.md` (P2–P4), `.claude/rules/uns-compliance.md` (P1,4,5), `.claude/rules/session-discipline.md` (scoped commits, regression recheck).

---

## Per-phase execution

> Agent types: **Explore** (read-only), **engineer/backend-developer** (code), **designer** (UI), **fork** (inherits my context for synthesis). Default model inherits session; bump effort only on the schema + matching phases.

### Phase 0 — Contract Definition
- **Skills:** `analysis-process` → `grill-with-docs` (against glossary/ADR-0017) → `writing-plans` → `to-issues`.
- **Subagent:** 1 `fork` to draft the 3 contract artifacts (TS/Python/JSON Schema) + ADR; orchestrator reviews against PRD §2/§3.
- **Parallel:** none (single source of truth).
- **Gate:** ADR merged; contract lints; glossary-consistent.

### Phase 1 — Hub Staging Schema
- **Skills:** `mira-uns-architecture`, `managing-the-knowledge-graph`, rule `mira-hub-migrations`.
- **Subagent:** 1 `backend-developer` (worktree) writes the migration + RLS + grants; **verify on ephemeral `postgres:16` under `SET ROLE factorylm_app` with a UUID tenant** (per rule §6).
- **Gate:** dry-run green on staging; tables+RLS proven with a reachable (UUID) tenant.

### Phase 2 — Import Endpoint + sha256 Dedup
- **Skills:** `tdd` (write §6 tests 1,3 first), rule `knowledge-entries-tenant-scoping`.
- **Subagent:** 1 `engineer` (worktree) — endpoint accepts contract, dedup, all-proposed.
- **Gate:** tests 1,3 pass; everything lands `proposed`.

### Phase 3 — Asset Matching (strong/probable/none)
- **Skills:** `tdd` (tests 4,5,6), `mira-architecture-guardian` (matching must not auto-verify).
- **Subagent:** 1 `engineer` (worktree, **effort: high** — this is the trickiest logic). Optional: 1 adversarial `Explore` reviewer to try to break the matcher (false-merge / missed-match).
- **Gate:** tests 4,5,6 pass; adversarial reviewer finds no false-merge.

### Phase 4 — Review Queue + Approval + No-Overwrite
- **Skills:** `managing-the-knowledge-graph` (proposed→approved is admin-only), `mira-uns-architecture` (publish to UNS), `tdd` (tests 7,8).
- **Subagents (parallel, worktree):** (a) `engineer` review-queue API + approval→publish; (b) `designer`+`engineer` minimal review-queue UI.
- **Gate:** tests 7,8 pass; re-import can't overwrite approved.

### Phase 5 — Offline Bundle Alignment  ‖  Phase 6 — Telegram Thin Client *(parallel after P4)*
- **P5 skills:** `tdd` (tests 10,11), `manual-ingestion-extractor`/`component-profile-builder` for evidence shape.
  - **Subagent:** 1 `engineer` (worktree) on `mira-contextualizer` — add `evidence.json`/`scorecard.json`, identity UUIDs, manifest intent/policy, full-vs-sanitized modes, staged-only import.
- **P6 skills:** `tdd` (test 9), `bot-adapters`, rule on sanitization (`security-boundaries`).
  - **Subagent:** 1 `engineer` (worktree) on `mira-bots/telegram` — submit the intake envelope (hints+sha256+OCR/raw) into the Hub pipeline.
- **Run as 2-thunk `parallel()`** (independent worktrees, no shared files).
- **Gate:** tests 9,10,11 pass.

### Phase 7 — Shared UI/UX Alignment
- **Skills:** `designer` agent, screenshot rule.
- **Subagent:** 1 `designer` — label/mental-model parity (Projects/Assets/Sources/Evidence/Signals/Faults/Parameters/UNS Map/Scorecard/Review Queue/History) across Hub + offline.
- **Gate:** label-parity audit + desktop/mobile screenshots to `docs/promo-screenshots/`.

### Phase 8 — Tests + Garage Conveyor Demo
- **Skills:** `documentation-process`, `verification-before-completion`, `mira-create-demo-plant` (fixture pattern).
- **Subagent:** 1 `engineer` — wire the demo fixture (real files: `MIRA/plc/Micro820_v4.1.9_Program.st`, `MbSrvConf_v4.xml`, `Downloads/gs10usermanual.pdf`) end-to-end; 1 `fork` writes demo docs.
- **Gate:** full §6 matrix green; demo §7 passes end-to-end; docs merged; commit+push on `feat/hubv3-contextualization-intake`.

---

## Dependency graph (what blocks what)

```
P0 contract ──▶ P1 schema ──▶ P2 import+dedup ──▶ P3 matching ──▶ P4 review/approve/no-overwrite
                                                                      │
                                                        ┌─────────────┴─────────────┐
                                                        ▼                           ▼
                                                  P5 offline bundle           P6 telegram   (parallel)
                                                        └─────────────┬─────────────┘
                                                                      ▼
                                                              P7 UI parity ──▶ P8 tests + demo
```

**Critical path:** P0→P1→P2→P3→P4→(P5‖P6)→P7→P8. P5/P6 collapse two phases of wall-clock into one via `parallel()`.

## Orchestration cadence (token budget)

- **Per phase:** orchestrator (1) invokes the design skill(s) for guidance, (2) dispatches the build subagent(s) with the phase's acceptance test as the goal, (3) reads only the verdict + test tail, (4) runs the alignment gate (`mira-architecture-guardian`), (5) commits the checkpoint. Main-thread context stays ≈ PRD + current verdict.
- **When to use a Workflow instead of hand-dispatch:** if Mike opts into multi-agent orchestration ("use a workflow" / ultracode), P2–P6 are a clean `pipeline()` (find→build→adversarially-verify per phase). Until then: hand-dispatched Agent calls, one phase at a time, with his approval at each gate (PR-per-phase, no auto-merge per repo rule).

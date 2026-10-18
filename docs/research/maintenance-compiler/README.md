# Maintenance Compiler research: agent takeover brief

**Status:** research complete. **Phase 1 approved by Mike on 2026-10-18** (inert package only; see the update below). Everything past Phase 1 still needs his go.
**Last updated:** 2026-10-18 · **Fact base:** `origin/main` @ `8ca0b52be` at the time of research; re-verify anything you depend on before building.

If you are a Claude (or Codex) agent picking this up, read this file first, then the three documents in order.

## ⚠️ Update 2026-10-18: direction set, Phase 1 in flight. This supersedes the "open decisions" below where they conflict

Read the direction comment on PR #4495 first: **[DIRECTION] MIRA runs on primitives and workflows** ([#4495 comment 6249449453](https://github.com/Mikecranesync/MIRA/pull/4495#issuecomment-6249449453)). Its report is **[MIRA on Primitives and Workflows](https://claude.ai/code/artifact/730f7a6b-4347-4c86-b59a-455e6dd8f350)**.

In short:
- **Models:** every technician action is a primitive MIRA can call, and primitives compose into workflows. Copy the *shapes* of HL7 FHIR PlanDefinition/ActivityDefinition, Temporal (human steps pause for a report; every event is logged) and AWS SSM Automation runbooks (YAML data, per-outcome routing, approval steps). Do not copy their infrastructure.
- **Shape:**
  - an action contract with `executor: mira | technician`, outcome `PASS | FAIL | INCONCLUSIVE | BLOCKED | UNSAFE` and verification `machine | self_reported | attested`;
  - templates as data;
  - a small pure step runner (no workflow engine);
  - a narrow LLM role: pick the next test from the allowed list, turn free text into typed fields, and never mark a safety step PASS;
  - an append-only run record kept in existing stores;
  - MIRA-executable actions exposed through `mira-mcp`.
- **In flight, coordinate there and don't duplicate:**
  - **#4498** Phase 1 (R1, Claude BRAVO): action library, 3 templates, validator and a pure `nextStep()` runner in `packages/factorylm-interaction/src/diagnostic-plan/`. Inert: nothing imports it.
  - **#4499** Hub + mobile sidebar (R0 → R2, Claude BRAVO).
- **Until Phase 2 is approved:**
  - No parallel plan/step/action model; extend `packages/factorylm-interaction`.
  - The Hub is the first surface, and mobile must end up identical (shared `packages/factorylm-ui`).
  - **Don't wire into `equipment-notebooks/[id]/chat/route.ts`.** Foreman holds #4303 there.
  - Safety wording for hazard/isolation actions is its own R3 slice.
  - Open with Mike: whether `UNSAFE` stopping a plan fits the 2026-09-27 "flag, never block" safety policy.
  - No PLC/VFD writes.
- **Phase 2** (behind `NOTEBOOK_DIAGNOSTIC_PLAN_ENABLED=0`, staging only, R3 because of the registry) needs Mike's go after Phase 1 merges.

**What changed relative to the decision package below:** Phase 1 is now the inert action-library package (#4498), not the "baseline-first" P1 in §7, and Temporal is used as a *shape reference*, not rejected outright. The package's facts, risks and measurement plan still stand. Run the §6 baseline before claiming any improvement.

## The documents

| # | File | What it is |
|---|---|---|
| 1 | [`2026-10-18-original-mission-brief.md`](2026-10-18-original-mission-brief.md) | Mike's original mission: investigate Atomic Machines, test a 30× hypothesis, read-only, decision package only |
| 2 | [`2026-10-18-owner-action-library-brief.md`](2026-10-18-owner-action-library-brief.md) | Mike's follow-up direction: a small standardized technician action library + workflow templates, and the reframed research question |
| 3 | [`2026-10-18-atomic-machines-decision-package.md`](2026-10-18-atomic-machines-decision-package.md) | The full investigation and recommendation: Atomic Machines facts vs. claims, MIRA architecture map with file:line evidence, opportunity matrix, 30× analysis, proposed architecture, validation plan, roadmap, risks, open decisions |

## Where things stand, in five lines

1. **Atomic Machines:** one product (PrimeSwitch relay) shipping for evaluation with company-only specs; the "Matter Compiler" planner/process library/learning loop is undocumented publicly; its patents are on the device, not the compiler. Phase 1 rests on web-search summaries because the research session's network blocked direct page fetches.
2. **What transfers:** a typed action contract with a per-step outcome (`PASS | FAIL | INCONCLUSIVE | BLOCKED | UNSAFE`) plus a `verification` class (`machine | self_reported | attested`), and a persisted per-step record. Both are older process-engineering ideas (ISA-88, FMEA-driven diagnostic trees).
3. **MIRA today:** no plan object; the active diagnose prompt forbids step lists (`mira-bots/prompts/diagnose/active.yaml:31`); `DiagnosticPlan`/`PlanStep`/`Hypothesis` UI types exist with no backend producer (`packages/factorylm-interaction/src/types.ts:254–275`); nothing learns from repair outcomes.
4. **30×:** not supportable as a target. No baseline exists for diagnosis time, steps, FTF or cost; the latest release gate recorded 0% grounded correctness and a HOLD (`evals/reports/f06922ac6-cov100-final.txt`). Physical work bounds whole-episode speedup to ~1.3–2.5×. Replace with the measurable targets in decision package §4.3.
5. **Recommendation:** reject the compiler as architecture; adapt the two principles as a small, default-off pilot in the Hub notebook chat route; measure first (P1 baseline) before building (P2).

## Open decisions (decision package §10), as originally written. See the update above for what has since been decided

1. Retire the 30× framing in favor of measurable targets.
2. Authorize **P1 baseline-first**: CV-101 golden baseline JSON (bench is human-operated, read-only), score arms A (current) and B (minimal plumbing) offline, commit scorecards.
3. Authorize **P2 PoC** (12 actions, 3 templates, plan producer behind `NOTEBOOK_DIAGNOSTIC_PLAN_ENABLED=0`) under the SDLC.
4. Approve or edit the 12-action list and the outcome enum.
5. Confirm the single surface (Hub notebook chat route only).
6. Approve reuse of the ASI-001 routine (`docs/plans/2026-10-09-field-maintenance-acceptance.md`) as an evaluation dataset, coordinated with its owners.
7. Housekeeping, independent of the above: BENCH-ONLY banner on `plc/vfd_fix_attempts.py`; contradictory `live_monitor.py` line in `.claude/rules/fieldbus-readonly.md`; dead `agent_trace.py` reference in `CLAUDE.md`; staging-gate 10-vs-15 question drift.

## Rules for whoever takes over

- **Get Mike's explicit authorization for the specific phase before building.** This PR authorizes nothing itself; Phase 1's approval lives in the direction comment and on #4498.
- Follow `docs/architecture/mira-sdlc-v1.md`: an owning issue, a `Risk:` line, a red→green test, and exact-head Codex GREEN where R3 applies. Use `.claude/rules/multi-session-protocol.md` for the claim.
- **No PLC/VFD writes, ever** (`.claude/rules/fieldbus-readonly.md`). CV-101 faults are induced by a human (unplug, load, block beam) and observed read-only. A cloud agent cannot reach the bench anyway; bench work needs a session on CHARLIE or a human.
- **No new workflow engine, registry or evidence store.** Reuse `equipment_notebook_turns.evidence`, `decision_traces` (mig 090 turn packet), drive-pack data loading, and the existing `plan`/`plan_step` UI parts.
- Paid inference only as a bounded validation lane (`.claude/rules/zero-token-architecture.md`); judge ≠ generator; held-out keys.
- Report speed only alongside correctness and dangerous-answer counts on the same cases.

## Suggested first move once P1 is authorized

Run the existing offline sets on the current head and commit scorecards: SimLab (`tests/simlab/runner.py`), the ASI-001 routine (fresh thread per arm, saved-turn scoring), the PT100/Klixon fixtures (`printsense/fixtures/scu2/`, `docs/eval/visual-technician-corpus/hard_failures/oem_brake_stator.yaml`), and the release-gate cases (`evals/BASELINE_TESTING_STANDARD.md`). That baseline is what every later claim gets measured against.

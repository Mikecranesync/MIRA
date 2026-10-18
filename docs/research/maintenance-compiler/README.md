# Maintenance Compiler research: agent takeover brief

**Status:** research complete, **no implementation authorized**. Awaiting Mike's decisions (below).
**Last updated:** 2026-10-18 · **Fact base:** `origin/main` @ `8ca0b52be` at the time of research; re-verify anything you depend on before building.

If you are a Claude (or Codex) agent picking this up, read this file first, then the three documents in order.

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

## Open decisions (decision package §10). Do not start work that depends on an unmade decision

1. Retire the 30× framing in favor of measurable targets.
2. Authorize **P1 baseline-first**: CV-101 golden baseline JSON (bench is human-operated, read-only), score arms A (current) and B (minimal plumbing) offline, commit scorecards.
3. Authorize **P2 PoC** (12 actions, 3 templates, plan producer behind `NOTEBOOK_DIAGNOSTIC_PLAN_ENABLED=0`) under the SDLC.
4. Approve or edit the 12-action list and the outcome enum.
5. Confirm the single surface (Hub notebook chat route only).
6. Approve reuse of the ASI-001 routine (`docs/plans/2026-10-09-field-maintenance-acceptance.md`) as an evaluation dataset, coordinated with its owners.
7. Housekeeping, independent of the above: BENCH-ONLY banner on `plc/vfd_fix_attempts.py`; contradictory `live_monitor.py` line in `.claude/rules/fieldbus-readonly.md`; dead `agent_trace.py` reference in `CLAUDE.md`; staging-gate 10-vs-15 question drift.

## Rules for whoever takes over

- **Get Mike's explicit authorization for the specific phase before building.** This PR authorizes nothing.
- Follow `docs/architecture/mira-sdlc-v1.md`: an owning issue, a `Risk:` line, a red→green test, and exact-head Codex GREEN where R3 applies. Use `.claude/rules/multi-session-protocol.md` for the claim.
- **No PLC/VFD writes, ever** (`.claude/rules/fieldbus-readonly.md`). CV-101 faults are induced by a human (unplug, load, block beam) and observed read-only. A cloud agent cannot reach the bench anyway; bench work needs a session on CHARLIE or a human.
- **No new workflow engine, registry or evidence store.** Reuse `equipment_notebook_turns.evidence`, `decision_traces` (mig 090 turn packet), drive-pack data loading, and the existing `plan`/`plan_step` UI parts.
- Paid inference only as a bounded validation lane (`.claude/rules/zero-token-architecture.md`); judge ≠ generator; held-out keys.
- Report speed only alongside correctness and dangerous-answer counts on the same cases.

## Suggested first move once P1 is authorized

Run the existing offline sets on the current head and commit scorecards: SimLab (`tests/simlab/runner.py`), the ASI-001 routine (fresh thread per arm, saved-turn scoring), the PT100/Klixon fixtures (`printsense/fixtures/scu2/`, `docs/eval/visual-technician-corpus/hard_failures/oem_brake_stator.yaml`), and the release-gate cases (`evals/BASELINE_TESTING_STANDARD.md`). That baseline is what every later claim gets measured against.

# PRD — Behavioral-fidelity harness: classic notebook chat vs `/v3`

**Status:** Draft (P0). **Owner:** Mike. **Claim:** #4439. **Risk:** R1 for the P1 PoC (local-only test code, no CI wiring); R3 when a workflow is added (P2). **ADR:** [0038](../adr/0038-behavioral-fidelity-harness.md).

## Problem

The unified-UI cutover keeps the classic presentation as the rollback path "until measured
parity, rollback, and stability requirements pass" (`docs/architecture/convergence/UNIFIED_UI_CUTOVER.md:31-32`),
and Gate 5 requires evidence/safety parity (`:627`). Nothing measures that parity automatically
today: the product-parity lane is scored by hand (`evals/scripts/run_android_workflows.py:1-22`),
and both recorded runs at `f06922ac6` show `Golden Conversation: NOT RUN` with a failing
safety-critical check (`evals/results/f06922ac6/report.txt:10,19`; `…-cov100/report.txt:10,21`).

Both surfaces are ours and talk to the same backend: the classic notebook
(`mira-hub/src/app/(hub)/equipment/[id]/page.tsx` → `components/equipment/NotebookChat.tsx:387`)
and `/v3` (`mira-hub/src/app/v3/page.tsx` → `factorylm-ui/hub-host.tsx:396`) both `POST
/api/equipment-notebooks/[id]/chat/`. So the classic UI is an **authorized, feature-frozen
reference oracle** for the clone.

## Approach (summary — decision in ADR-0038)

Serve both UIs the **same** backend behavior from route handlers in Playwright (`page.route`),
then diff what each client **does** with it. Responses are identical by construction, so they
are never the measured signal. The measured signals are:

1. **Request fidelity** — the chat request each client sends for the same user action.
2. **Rendered-turn fidelity** — what each client shows from the same SSE stream.
3. **Live ≡ hydrated** — what each client shows after a reload, from the persisted turn.

The SSE body and the hydrated turn are produced **hermetically from the real route code**
(the existing vitest route scaffold, `src/capabilities/__tests__/provider-health.route.test.ts`),
not hand-written and not captured from a tenant. $0 inference.

## Scope (P1)

One notebook with one indexed manual source; two prompts:

- **G** — grounded: a fault-code question answered with a citation (doc + page).
- **S** — safety: an imminent-hazard question that must render the safety notice first.

Golden Conversation steps compared (`evals/golden-conversations/golden-conversation.md:11-24`):
**5** grounded answer, **6** citation inspectable, **7** persists after reload. **Step 3 is
N/A** for this pair: the classic page is per-machine by design. Steps 1, 2, 4 and 8 are out of
P1 scope.

Out of scope: mobile/Capacitor (P3), visual pixel diff against the classic UI (the shell is a
deliberate redesign — visual baselines are clone-vs-own-baseline only), CI wiring (P2), any
change under a guarded path.

## Acceptance criteria (each checkable)

| # | Criterion | Measure | Target |
|---|---|---|---|
| AC1 | Harness lives only under `mira-hub/tests/fidelity/**` and adds no dependency | `git diff --stat` + `package.json`/lockfile unchanged | 0 files outside; 0 dep changes |
| AC2 | Every network request in a run is served by a declared handler | unrecognized-request list per run | empty (else the run fails) |
| AC3 | Request fidelity: normalized chat request body equal across surfaces for G and S | field diff after normalization | 0 diffs outside the documented allowlist |
| AC4 | Rendered-turn fidelity for G and S | extracted record: answer text, citations (doc, page), safety notice present + first, evidence label | equal on both surfaces |
| AC5 | Citation inspectable (step 6) | tapping the first citation opens the cited doc + page on each surface | both surfaces |
| AC6 | Live ≡ hydrated (step 7) | rendered-turn record after reload equals the live record, per surface | equal on both surfaces |
| AC7 | Determinism | 3 runs per surface produce identical normalized records | 3/3 |
| AC8 | Detects clone defects | each seeded mutation of the **clone's code** turns exactly its named check red; counts recorded both ways | ≥3 rendered-side + ≥1 request-side mutation, each caught |
| AC9 | No false alarms | unchanged clone vs reference | 0 diffs on 3/3 runs |
| AC10 | Cost and data | paid inference calls; tenant data in fixtures | 0; none |

**Named first-red test:** `fidelity.spec.ts › rendered turn: grounded answer` run against a
clone whose citation rendering is removed (AC8 mutation M1) — must fail before any fix is
claimed (`.claude/rules/prove-the-test-fails.md`).

## Allowlist policy

Any field allowed to differ between surfaces is listed in `mira-hub/tests/fidelity/allowlist.ts`
with a one-line reason (e.g. per-surface `clientRequestId`). An unexplained difference is a
failure, never a silent allowance.

## Later phases (not authorized)

P2 advisory CI job (R3; Codex exact-head review) → P3 mobile via `tools/mobile-e2e` + CDP →
P4 capability scenario inside the existing acceptance receipt (`docs/architecture/mira-sdlc-v1.md:404-431`)
after 30 days of reliability data. Record the classic oracle **before** `legacy_retired`.

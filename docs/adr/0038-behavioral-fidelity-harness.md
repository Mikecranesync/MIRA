# ADR-0038 — Behavioral fidelity by differential replay, not decompilation

**Status:** Proposed — 2026-10-14 (awaiting Mike). **PRD:** [2026-10-14-behavioral-fidelity-harness](../prd/2026-10-14-behavioral-fidelity-harness.md). **Claim:** #4439.

## Context

We want reconstructed surfaces (the unified shell replacing the classic Hub/mobile
presentation) to match an authorized reference with measurable fidelity rather than
approximate look-alikes. Public demonstrations of AI-assisted cloning decompile a binary
(Ghidra) and have an LLM re-implement it. Our references are our own TypeScript/Python
applications with full source and a shared backend, so the decompilation half adds nothing;
what we lack is the validation half — an automated reference-vs-clone comparison.

Verified existing assets: per-surface parity guards (`tests/regime7_ignition/test_diagnose_parity.py`,
`tests/simlab/test_cross_surface_conformance.py`), Playwright with `page.route` fixtures in
`mira-hub/tests/e2e/`, the Golden Conversation spec, and hand-scored product-parity workflows.
Verified absent: HAR/`routeFromHAR`, ARIA snapshots, any automated reference-vs-clone runner,
and any binary-RE tooling.

## Decision

1. **Differential replay.** Serve the reference and the clone the same backend behavior via
   Playwright route handlers keyed on path (query ignored), with a catch-all that fails the run
   on any unrecognized request and `serviceWorkers: "block"`.
2. **Measure client behavior, not responses.** Compare (a) the requests each client sends,
   (b) the rendered turn record each client produces, (c) live vs hydrated-after-reload — never
   response bytes, which are equal by construction.
3. **Oracle fixtures from real code.** Generate the SSE body and the hydrated turn by running
   the real route handlers under the vitest route scaffold. No tenant capture, $0 inference.
4. **Prove it can fail.** Each check is shown red by mutating the clone's code, never the fixture.
5. **No binary RE.** Ghidra/Frida/JADX are not adopted; a third-party target requires written
   legal authorization and is limited to black-box observation.
6. **Reuse before build.** Only the already-installed `@playwright/test` and vitest; the
   normalizer and differ are small local code. No new dependency, no second registry; evidence
   stays in GitHub-native artifacts (`docs/architecture/mira-sdlc-v1.md:637-640`).

## Consequences

- The classic UI's recorded behavior becomes a frozen oracle; it must be captured before the
  classic surface is retired.
- Visual diffs are clone-vs-own-baseline only; cross-surface comparison is semantic.
- A CI lane (P2) is R3 and starts advisory; promotion into the acceptance receipt (P4) follows
  the SDLC reliability rule.
- The harness cannot see server-side behavior; backend parity stays with route tests.

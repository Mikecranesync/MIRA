# Autonomous Run Plan — FactoryLM Technician Showcase Sprint

**Date:** 2026-08-30
**Branch:** `codex/technician-showcase-sprint`
**Base:** `origin/main` at `6250dd442819f172901eb6c724074a2c18f886bb`
**Operators:** Claude Code implementation lanes, directed and independently reviewed by Codex
**Approved design:** `docs/superpowers/specs/2026-08-30-technician-showcase-sprint-design.md`
**Primary PRD:** `docs/prd/2026-08-29-technician-beta-recovery-prd.md`

## Objective

Develop the approved one-minute technician proof while preserving the existing safety, identity,
evidence, tenant, inference, Notebook, Drive Commander, Sensor, and Machine Memory seams:

> Photograph the problem. Get a safe, cited answer in under 60 seconds.

This coordinator branch owns the design, task plans, integration decisions, and sprint handoff. Each
implementation lane uses a separate worktree and PR with non-overlapping file ownership. Mike alone
merges, deploys, operates physical hardware, supplies production secrets, or makes external product
claims.

## Numbered scope

1. **Lock the sprint architecture and execution map**
   - Record the approved product hierarchy, experience contract, safety invariants, lane boundaries,
     acceptance gates, and human-only gates in the sprint design.
   - Audit current `origin/main`, open PRs, and existing worktrees before assigning file ownership.
   - Produce exact TDD implementation plans for the independent lanes before product-code edits.
   - **Success:** the design and plans contain no placeholders, name exact files/interfaces/tests,
     cover every approved requirement, and pass `git diff --check` plus plan self-review.

2. **Lane C — complete Machine Memory truth and operational proof**
   - Implement PRD Workstream C without fabricating live, replay, stale, unavailable, empty, physical,
     or simulated state.
   - Add the read-only preflight and scheduled observer through existing operational seams.
   - **Success:** deterministic tests cover all required states; a merge-ready PR and redacted
     evidence exist; the seven-day production artifact remains explicitly Mike-gated.

3. **Lane D — complete Android credibility**
   - Make photography actions use native camera capture while preserving the existing evidence path.
   - Ship honest buffered-response UX unless Mike separately authorizes a streaming trust-boundary ADR.
   - **Success:** emulator-native camera/upload/cancel/retry/evidence tests pass; a release-ready APK
     evidence package is prepared; physical Pixel installation and smoke remain Mike-gated.

4. **Lane E — build the synthetic technician recovery battery**
   - Extend the existing synthetic dogfood scheduler, finding schema, artifact root, and E2E seams for
     the five approved personas and run-unique manuals.
   - **Success:** two consecutive release-candidate batteries satisfy the PRD pass rules with tenant
     isolation, correct citations, provider-free refusal, and run-owned cleanup.

5. **Lane S — compose the integrated one-minute showcase**
   - Start only after the reviewed C/D/E interfaces are stable.
   - Compose camera/identity confirmation, Drive Commander/Notebook evidence, grounded answer,
     citation opening, follow-up/refusal, and save-to-memory through existing seams.
   - **Success:** the synthetic journey proves the complete experience and reports honest elapsed
     time; no duplicated pipeline, unsafe advice, false live state, or unopenable citation remains.

6. **Independently review, verify, and hand off each lane**
   - Codex performs separate specification-compliance and code-quality reviews against exact heads.
   - Run focused suites, affected module suites, safety/grounding gates, build/lint/security checks,
     and full required CI before recommending a merge.
   - **Success:** each lane has a scoped diff, conventional commits, pushed branch, merge-ready PR,
     exact reproduce commands, and a truthful HANDOFF; no lane merges or deploys without Mike.

## Explicitly out of scope

- Production deploys, production probe dispatches, Doppler production access, raw production SQL,
  direct VPS mutation, physical bench operation, APK installation/distribution, or Play Console work.
- Human-technician, design-partner-readiness, willingness-to-pay, or production-live claims made from
  synthetic evidence.
- PLC/drive writes, resets, parameter changes, control words, state-changing services, or a new OT
  connector.
- A sixth app tab, second chat surface, second conversation or Machine Memory store, second inference
  cascade, second safety classifier, second evidence/identity/retrieval/ingest pipeline, or auto-verified
  KG state.
- Broad ChatGPT-parity polish, generic dashboards, unrelated PrintSense/Sensor capabilities, new
  product families, or refactors not required by the approved one-minute journey.
- Edits to files owned by another active PR/worktree unless ownership is resolved before editing.
- Autonomous merges. Mike is the only merge authority.

## File-ownership discipline

- No two active implementation agents may write the same path.
- Explorers and reviewers are read-only unless explicitly promoted to an implementation lane.
- Each lane plan lists its complete write allowlist and verification commands.
- If an open PR or active worktree overlaps a planned write path, that lane stops until the overlap is
  rebased, superseded, merged, or explicitly reassigned.
- Lane S may not begin by editing around an incomplete C/D/E contract; it waits or consumes the
  reviewed interface.

## Hard stops

- A required change would weaken tenant isolation, source approval, provider-free refusal, citation
  integrity, safety STOP behavior, or read-only OT boundaries.
- A lane requires a new product/architecture/security/dependency decision not settled in the design.
- A test would need customer data, raw production access, uncontrolled cleanup, or a false live claim.
- The same stop-gate failure repeats twice, the same test remains blocked for five consecutive turns,
  or a lane reaches the autonomous-run turn/context cap.
- Remaining work is human-gated; write one consolidated HANDOFF and stop instead of retrying.

## Required verification before any completion claim

1. `git status --short --branch`
2. `git log --oneline $(git merge-base origin/main HEAD)..HEAD`
3. `git diff --name-only $(git merge-base origin/main HEAD)..HEAD`
4. `git diff --check`
5. Affected focused tests named in the lane plan
6. Affected module build/lint/type/security gates
7. Required CI and staging/synthetic gates named in the PRD
8. Scope review against this PLAN and the lane write allowlist
9. Final `HANDOFF.md` with row-by-row status, risks, skipped human gates, and exact reproduce commands

## Operator notes

- Work only in isolated worktrees created from current `origin/main`.
- Keep `MIRA_ALLOW_PROD` and `MIRA_SKIP_STOP_GATE` unset.
- Keep each shell cwd at its lane worktree root so repository hooks resolve correctly.
- Commit and push coherent progress frequently; never force-push main/develop/dev.
- `brain_search` and the autonomous-run memory entries are not callable in this environment. The
  repository PRDs, `wiki/hot.md`, `wiki/references/overnight-runs.md`, GitHub state, and the available
  `docs/memory-snapshots/2026-05-02/MEMORY.md` are the continuity sources.
